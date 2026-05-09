# GitHub Repo Setup

Target repository name: `telemedicine-next-supabase`.

This Codex session can read and update repositories through the installed GitHub connector, but the available connector tools do not include repository creation, `gh` is not installed, and no `GITHUB_TOKEN`/`GH_TOKEN` is available in the shell environment. Because of that, the migration is prepared locally and can be pushed as soon as the new GitHub repository exists.

After creating the repo in GitHub:

```bash
git remote rename origin source-telemedicine
git remote add origin https://github.com/puneetdixit200/telemedicine-next-supabase.git
git add .
git commit -m "feat: migrate telemedicine to next supabase"
git push -u origin main
```

If you want to preserve the original repository remote exactly as-is, create a fresh clone of this workspace before changing remotes.
