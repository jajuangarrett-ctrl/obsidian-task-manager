import FoundationModels

@Generable(description: "A reviewable task draft extracted from one email")
struct GeneratedTaskDraft {
  @Guide(description: "Concise action-oriented title, at most 12 words")
  var title: String

  @Guide(description: "Requested action and essential context without invented facts")
  var details: String

  @Guide(description: "One allowed task status", .anyOf(["inbox", "do-first", "do-soon", "ongoing", "delegate", "waiting", "on-hold"]))
  var status: String

  @Guide(description: "One exact project supplied in the instructions, or an empty string")
  var project: String

  @Guide(description: "Explicit due date as YYYY-MM-DD, or an empty string")
  var due: String

  @Guide(description: "Explicitly delegated person, or an empty string")
  var delegatedTo: String

  var value: GeneratedTaskDraftValue {
    GeneratedTaskDraftValue(
      title: title,
      details: details,
      status: status,
      project: project,
      due: due,
      delegatedTo: delegatedTo
    )
  }
}

@Generable(description: "A reviewable agenda item extracted from one email")
struct GeneratedAgendaDraft {
  @Guide(description: "One exact roster member supplied in the instructions, or an empty string")
  var team: String

  @Guide(description: "One concise discussion item preserving names, commitments, and deadlines")
  var text: String

  @Guide(description: "Agenda priority", .anyOf(["Standard", "High Impact"]))
  var priority: String

  @Guide(description: "Optional topic hashtag without a leading hash, or an empty string")
  var hashtag: String

  var value: GeneratedAgendaDraftValue {
    GeneratedAgendaDraftValue(team: team, text: text, priority: priority, hashtag: hashtag)
  }
}

@Generable(description: "A concise update for an existing task extracted from one email")
struct GeneratedUpdateDraft {
  @Guide(description: "Concrete update preserving decisions, commitments, dates, names, and blockers")
  var text: String

  var value: GeneratedUpdateDraftValue { GeneratedUpdateDraftValue(text: text) }
}
