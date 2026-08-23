#!/bin/zsh
set -euo pipefail

script_directory="${0:A:h}"
integration_root="${script_directory:h}"
install_root="${HOME}/Library/Application Support/FJG Task Manager/Mail Capture"
service_root="${HOME}/Library/Services/Save Mail to FJG Vault.workflow"
service_document="${service_root}/Contents/document.wflow"

/usr/bin/env node "${script_directory}/build.mjs"

if [[ -e "${service_document}" ]] && ! /usr/bin/grep -q "FJG_MAIL_CAPTURE_WORKFLOW" "${service_document}"; then
  existing_service_name="$(/usr/libexec/PlistBuddy -c 'Print :NSServices:0:NSMenuItem:default' "${service_root}/Contents/Info.plist" 2>/dev/null || true)"
  existing_service_message="$(/usr/libexec/PlistBuddy -c 'Print :NSServices:0:NSMessage' "${service_root}/Contents/Info.plist" 2>/dev/null || true)"
  if [[ "${existing_service_name}" != "Save Mail to FJG Vault" || "${existing_service_message}" != "runWorkflowAsService" ]]; then
    print -u2 "Refusing to replace an unrelated Quick Action at: ${service_root}"
    exit 1
  fi
fi

/bin/mkdir -p "${install_root}" "${service_root}/Contents"
/usr/bin/install -m 0644 "${integration_root}/dist/capture-mail.js" "${install_root}/capture-mail.js"
/usr/bin/install -m 0644 "${integration_root}/workflow/Contents/document.wflow" "${service_document}"
/usr/bin/install -m 0644 "${integration_root}/workflow/Contents/Info.plist" "${service_root}/Contents/Info.plist"

/System/Library/CoreServices/pbs -flush >/dev/null 2>&1 || true
print "Installed Apple Mail capture script: ${install_root}/capture-mail.js"
print "Installed Mail Quick Action: ${service_root}"
print "In Mail, select one message and choose Mail > Services > Save Mail to FJG Vault."
