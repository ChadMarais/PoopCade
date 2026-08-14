# Repository handoff instructions

When a task changes files in this repository, every final response must include an exact, copy-paste-ready PowerShell command block for publishing the work that is still outstanding at that moment.

The commands must be derived from the live repository state immediately before the final response. Inspect `git status --short`, the current branch, its upstream, configured remotes, and the repository deployment configuration. Never provide generic placeholders when the real values can be discovered locally.

The handoff must:

1. Start from `C:\Projects\Poopcade`.
2. Run the relevant verification commands before committing.
3. Stage explicit intended paths. Do not use `git add .` or `git add -A` when unrelated or generated files are present.
4. Show a concrete commit message appropriate to the outstanding changes.
5. Rebase safely with `git pull --rebase --autostash` when the current branch has an upstream, then push that exact branch and remote.
6. Include required non-Git production deployment commands after the push. For NEBULA MURDERBALL, deploy the `multiplayer` Cloudflare Worker before deploying the root static site.
7. Include concise post-deploy health checks when an endpoint is configured.
8. Clearly separate files intentionally included from unrelated or generated files intentionally left untracked.

If there are no outstanding file changes, say so and provide only commands that are genuinely still required. Never claim that `git push` alone deploys a component unless the repository is actually configured to do that automatically.
