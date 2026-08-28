import AppKit
import Foundation
import FoundationModels

private struct Options {
  var mode: CaptureMode?
  var vaultRoot = URL(fileURLWithPath: "/Users/franklingarrett/FJG Vault", isDirectory: true)
  var messageJSON: URL?
  var mailScript: URL?
  var scope: CaptureScope = .full
  var dryRun = false
  var noAlerts = false
  var checkModel = false
}

@main
struct FJGMailIntelligenceApp {
  static func main() async {
    do {
      let options = try parseOptions(Array(CommandLine.arguments.dropFirst()))
      if options.checkModel {
        print(availabilityDescription(SystemLanguageModel.default.availability))
        return
      }
      guard let mode = options.mode else {
        throw MailIntelligenceError.invalidArguments("Choose --mode task, update, or agenda.")
      }
      try requireAvailableModel()
      var message = try readMessage(options: options)
      let scope = try resolvedScope(options.scope)
      if scope == .clipboard {
        let excerpt = await MainActor.run {
          NSPasteboard.general.string(forType: .string)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        }
        guard !excerpt.isEmpty else {
          throw MailIntelligenceError.invalidArguments("Copy the highlighted email text before choosing Copied Excerpt.")
        }
        message.body = excerpt
      }
      let context = VaultContext.load(vaultRoot: options.vaultRoot)
      let input = modelInput(for: message)
      let url: URL

      switch mode {
      case .task:
        let session = LanguageModelSession(instructions: taskInstructions(projects: context.projects, localDate: localDate()))
        let response = try await session.respond(to: input, generating: GeneratedTaskDraft.self)
        url = try makeReviewURL(
          mode: .task,
          payload: makeTaskPayload(generated: response.content.value, message: message, projects: context.projects)
        )
      case .agenda:
        let session = LanguageModelSession(instructions: agendaInstructions(roster: context.roster))
        let response = try await session.respond(to: input, generating: GeneratedAgendaDraft.self)
        url = try makeReviewURL(
          mode: .agenda,
          payload: makeAgendaPayload(generated: response.content.value, message: message, roster: context.roster)
        )
      case .update:
        let session = LanguageModelSession(instructions: updateInstructions())
        let response = try await session.respond(to: input, generating: GeneratedUpdateDraft.self)
        url = try makeUpdateURL(text: makeUpdateText(generated: response.content.value, message: message))
      }

      if options.dryRun {
        print(url.absoluteString)
      } else {
        let opened = await MainActor.run { NSWorkspace.shared.open(url) }
        if !opened { throw MailIntelligenceError.couldNotOpenObsidian }
      }
    } catch is CancellationError {
      return
    } catch {
      let message = error.localizedDescription
      fputs("FJG Mail Intelligence: \(message)\n", stderr)
      let suppressAlerts = CommandLine.arguments.contains("--no-alerts")
      if !suppressAlerts { showFailure(message) }
      Foundation.exit(EXIT_FAILURE)
    }
  }

  private static func parseOptions(_ arguments: [String]) throws -> Options {
    var result = Options()
    var index = 0
    while index < arguments.count {
      let argument = arguments[index]
      switch argument {
      case "--mode":
        index += 1
        guard index < arguments.count, let mode = CaptureMode(rawValue: arguments[index]) else {
          throw MailIntelligenceError.invalidArguments("--mode must be task, update, or agenda.")
        }
        result.mode = mode
      case "--vault":
        index += 1
        guard index < arguments.count else { throw MailIntelligenceError.invalidArguments("--vault requires a path.") }
        result.vaultRoot = URL(fileURLWithPath: arguments[index], isDirectory: true)
      case "--message-json":
        index += 1
        guard index < arguments.count else { throw MailIntelligenceError.invalidArguments("--message-json requires a path.") }
        result.messageJSON = URL(fileURLWithPath: arguments[index])
      case "--mail-script":
        index += 1
        guard index < arguments.count else { throw MailIntelligenceError.invalidArguments("--mail-script requires a path.") }
        result.mailScript = URL(fileURLWithPath: arguments[index])
      case "--scope":
        index += 1
        guard index < arguments.count, let scope = CaptureScope(rawValue: arguments[index]) else {
          throw MailIntelligenceError.invalidArguments("--scope must be full, clipboard, or prompt.")
        }
        result.scope = scope
      case "--dry-run": result.dryRun = true
      case "--no-alerts": result.noAlerts = true
      case "--check-model": result.checkModel = true
      default: throw MailIntelligenceError.invalidArguments("Unknown option: \(argument)")
      }
      index += 1
    }
    return result
  }

  private static func requireAvailableModel() throws {
    switch SystemLanguageModel.default.availability {
    case .available: return
    case .unavailable(.deviceNotEligible):
      throw MailIntelligenceError.modelUnavailable("This Mac is not eligible for on-device Apple Intelligence.")
    case .unavailable(.appleIntelligenceNotEnabled):
      throw MailIntelligenceError.modelUnavailable("Turn on Apple Intelligence in System Settings, then try again.")
    case .unavailable(.modelNotReady):
      throw MailIntelligenceError.modelUnavailable("The on-device Apple Intelligence model is still downloading or not ready. Try again after setup completes.")
    @unknown default:
      throw MailIntelligenceError.modelUnavailable("The on-device Apple Intelligence model is unavailable.")
    }
  }

  private static func readMessage(options: Options) throws -> MailMessage {
    if let url = options.messageJSON {
      do { return try JSONDecoder().decode(MailMessage.self, from: Data(contentsOf: url)) }
      catch { throw MailIntelligenceError.mailReadFailed("The supplied test message could not be decoded: \(error.localizedDescription)") }
    }

    let defaultScript = URL(fileURLWithPath: CommandLine.arguments[0])
      .deletingLastPathComponent()
      .appendingPathComponent("extract-mail.js")
    let script = options.mailScript ?? defaultScript
    guard FileManager.default.fileExists(atPath: script.path) else {
      throw MailIntelligenceError.mailReadFailed("Mail reader is missing at \(script.path). Reinstall the Quick Actions.")
    }
    let process = Process()
    let output = Pipe()
    let errors = Pipe()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
    process.arguments = ["-l", "JavaScript", script.path]
    process.standardOutput = output
    process.standardError = errors
    do { try process.run() }
    catch { throw MailIntelligenceError.mailReadFailed(error.localizedDescription) }
    process.waitUntilExit()
    let data = output.fileHandleForReading.readDataToEndOfFile()
    let errorData = errors.fileHandleForReading.readDataToEndOfFile()
    if process.terminationStatus != 0 {
      let detail = String(data: errorData, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "Unknown Mail error"
      throw MailIntelligenceError.mailReadFailed(detail)
    }
    do { return try JSONDecoder().decode(MailMessage.self, from: data) }
    catch { throw MailIntelligenceError.mailReadFailed("Mail returned unreadable message data: \(error.localizedDescription)") }
  }

  private static func availabilityDescription(_ availability: SystemLanguageModel.Availability) -> String {
    switch availability {
    case .available: "available"
    case .unavailable(.deviceNotEligible): "device-not-eligible"
    case .unavailable(.appleIntelligenceNotEnabled): "apple-intelligence-not-enabled"
    case .unavailable(.modelNotReady): "model-not-ready"
    @unknown default: "unavailable"
    }
  }

  @MainActor
  private static func resolvedScope(_ requested: CaptureScope) throws -> CaptureScope {
    guard requested == .prompt else { return requested }
    NSApplication.shared.setActivationPolicy(.accessory)
    NSApplication.shared.activate(ignoringOtherApps: true)
    let alert = NSAlert()
    alert.messageText = "What should Apple Intelligence review?"
    alert.informativeText = "Use the complete selected email, or text you highlighted and copied before running this command."
    alert.addButton(withTitle: "Full Email")
    alert.addButton(withTitle: "Copied Excerpt")
    alert.addButton(withTitle: "Cancel")
    switch alert.runModal() {
    case .alertFirstButtonReturn: return .full
    case .alertSecondButtonReturn: return .clipboard
    default: throw CancellationError()
    }
  }

  private static func localDate() -> String {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone(identifier: "America/Los_Angeles")
    formatter.dateFormat = "yyyy-MM-dd"
    return formatter.string(from: Date())
  }

  @MainActor
  private static func showFailure(_ message: String) {
    NSApplication.shared.setActivationPolicy(.accessory)
    NSApplication.shared.activate(ignoringOtherApps: true)
    let alert = NSAlert()
    alert.alertStyle = .critical
    alert.messageText = "Mail item was not drafted"
    alert.informativeText = message
    alert.addButton(withTitle: "OK")
    alert.runModal()
  }
}
