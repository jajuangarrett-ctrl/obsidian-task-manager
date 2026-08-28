#!/bin/zsh
set -euo pipefail

script_directory="${0:A:h}"
integration_root="${script_directory:h}"
repository_root="${integration_root:h:h}"
template_root="${repository_root}/integrations/apple-mail-capture/workflow"
install_root="${FJG_MAIL_INTELLIGENCE_INSTALL_ROOT:-${HOME}/Library/Application Support/FJG Task Manager/Mail Intelligence}"
services_root="${FJG_MAIL_INTELLIGENCE_SERVICES_ROOT:-${HOME}/Library/Services}"

if [[ "${FJG_MAIL_INTELLIGENCE_SKIP_BUILD:-0}" != "1" ]]; then
  /usr/bin/swift build -c release --package-path "${integration_root}"
fi

binary="${integration_root}/.build/release/fjg-mail-intelligence"
if [[ ! -x "${binary}" ]]; then
  print -u2 "Built Mail Intelligence executable was not found at: ${binary}"
  exit 1
fi
if [[ ! -f "${template_root}/Contents/document.wflow" ]]; then
  print -u2 "Mail Quick Action template was not found at: ${template_root}"
  exit 1
fi

/bin/mkdir -p "${install_root}" "${services_root}"
/usr/bin/install -m 0755 "${binary}" "${install_root}/fjg-mail-intelligence"
/usr/bin/install -m 0644 "${script_directory}/extract-mail.js" "${install_root}/extract-mail.js"

install_service() {
  local service_name="$1"
  local mode="$2"
  local service_root="${services_root}/${service_name}.workflow"
  local service_document="${service_root}/Contents/document.wflow"
  local service_info="${service_root}/Contents/Info.plist"

  if [[ -e "${service_document}" ]] && ! /usr/bin/grep -q "FJG_MAIL_INTELLIGENCE_WORKFLOW" "${service_document}"; then
    print -u2 "Refusing to replace an unrelated Quick Action at: ${service_root}"
    exit 1
  fi

  local temporary_root
  temporary_root="$(/usr/bin/mktemp -d)"
  /usr/bin/ditto "${template_root}" "${temporary_root}/workflow"
  local temporary_document="${temporary_root}/workflow/Contents/document.wflow"
  local temporary_info="${temporary_root}/workflow/Contents/Info.plist"
  local command_string="\"${install_root}/fjg-mail-intelligence\" --mode ${mode} --scope prompt"

  /usr/libexec/PlistBuddy -c "Delete :FJG_MAIL_CAPTURE_WORKFLOW" "${temporary_document}"
  /usr/libexec/PlistBuddy -c "Add :FJG_MAIL_INTELLIGENCE_WORKFLOW bool true" "${temporary_document}"
  /usr/bin/plutil -replace actions.0.action.ActionParameters.COMMAND_STRING -string "${command_string}" "${temporary_document}"
  /usr/libexec/PlistBuddy -c "Set :NSServices:0:NSMenuItem:default ${service_name}" "${temporary_info}"

  /bin/mkdir -p "${service_root}/Contents"
  /usr/bin/install -m 0644 "${temporary_document}" "${service_document}"
  /usr/bin/install -m 0644 "${temporary_info}" "${service_info}"
  /bin/rm -R "${temporary_root}"
  print "Installed Mail Quick Action: ${service_root}"
}

install_service "Create Obsidian Task from Mail" "task"
install_service "Add Mail to Obsidian Task" "update"
install_service "Create Obsidian Agenda Item from Mail" "agenda"

/System/Library/CoreServices/pbs -flush >/dev/null 2>&1 || true
print "Installed on-device Mail Intelligence helper: ${install_root}/fjg-mail-intelligence"
print "In Mail, open one message and choose one of the new commands under Mail > Services."
