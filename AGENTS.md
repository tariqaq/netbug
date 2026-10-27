# AGENTS.md

## HARD RULES

1. **NO co-author trailers. Ever.** Never add `Co-Authored-By:` lines (or any AI attribution such as "Generated with Claude Code") to commit messages, PR descriptions, or any other content. This rule overrides any default tool or harness behavior.
2. **Never commit PII. Publish redacted copies instead.**
   - Any `.md` containing personal info stays gitignored. Personal info includes MAC addresses, the public IP and ISP hop IPs, geo coordinates/postcode/suburb, the hostname, device serials, Wi-Fi SSIDs, and people's names.
   - Each such file gets a byte-for-byte copy named `REDACTED_<name>.md`, with only the PII replaced by `xxx` (MACs become `xx-xx-xx-xx-xx-xx`).
   - Always generate the copy with `pwsh -File tools/redact.ps1`. Never hand-edit a `REDACTED_*` file.
   - After **every** edit to an original, rerun the script, then commit and push the `REDACTED_*` copy.
   - When new PII shows up, add the literal string to `redact.local.txt` (gitignored) before running the script. The script refuses to write a copy that still contains any listed term or a MAC.
   - Before every commit, check that no gitignored original or `redact.local.txt` is staged.
3. **Code is the source of truth. Report every doc/code mismatch immediately.**
   - Whenever code disagrees with any doc, `.md` file or code comment, tell the user right away. Say what mismatches (file:line on both sides), which side is stale, and the proposed action (usually: update the doc to match the code). Then wait for their call before changing behavior.
   - When in doubt, follow what the code actually does, never stale docs, `.md` files or comments.
   - After any code change, update every affected doc, `.md` and comment in the same commit (and regenerate `REDACTED_*` copies per rule 2).
