# Fix for "Binary files are not supported" when updating PR branch

If the PR branch ever contained binary files (for example `.zip`), GitHub may keep rejecting **Update branch** even after those files are deleted in later commits.

## Recommended fix (history-safe)

1. Ensure your local branch points to the clean commit lineage (no binary commit in history):
   ```bash
   git checkout clean-no-binaries
   ```
2. Force-update the remote PR branch (replace `<pr-branch>`):
   ```bash
   git push --force-with-lease origin clean-no-binaries:<pr-branch>
   ```
3. Reload the PR page. The update error should be gone.

## Verify before force-push

Run both checks from repo root:

```bash
git log --oneline --decorate -n 6
git ls-files | rg '\\.(zip|png|jpg|jpeg|gif|webp|ico)$' || true
```

Expected:
- recent history should **not** include commit `8f06a80` (the zip export commit).
- binary-extension listing should be empty.

## Why `.gitignore` alone is not enough

`.gitignore` prevents *new* binary files from being added, but it does not remove binaries that already exist in branch history.
