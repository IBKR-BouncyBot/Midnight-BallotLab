# Public identity and retained evidence

The project owner is identified publicly as **IBKR-BouncyBot**. The noncommercial license and third-party notices remain in force.

On 3 November 2026, the owner's personal name was replaced with this alias in project notices and removed from repository history. Personal operating-system usernames in four retained local demonstration logs were replaced with `[user]`:

- `evidence/2026-11-03/native-demo-first.log`
- `evidence/2026-11-03/native-demo-final.log`
- `evidence/2026-11-03/v0.5.0/native-demo.log`
- `evidence/2026-11-03/v0.6.0/native-demo.log`

These are privacy-redacted copies of earlier command output. Ballot counts, results and execution status were not changed. The demonstration now logs only the output filename, avoiding personal machine paths in future reports.

History redaction changes Git commit identifiers. Original commit identifiers and artifact digests in execution reports remain historical evidence of the runs actually performed; they do not claim that those runs executed a rewritten commit. Affected downloadable site artifacts are removed and replaced with a fresh build. Clean test-evidence artifacts remain available.

Existing clones should be replaced or carefully rebased onto the cleaned history. Merging the previous history can restore the removed data. Removal from the repository does not erase copies already downloaded elsewhere or guarantee removal from GitHub's cached commit views.
