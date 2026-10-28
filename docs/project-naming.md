# Smart Factory workspace and repository names

The product name is **Smart Factory**. The canonical local parent is
`/Users/andrewgotora/Software Development/GitHub/smart-factory`.
It is a plain workspace containing three independent Git repositories.

| Component | Folder under the parent | GitHub repository | Default branch |
| --- | --- | --- | --- |
| Frontend and Node API | `smart-factory-frontend` | [DruHustle/smart-factory-frontend](https://github.com/DruHustle/smart-factory-frontend) | `main` |
| .NET services | `smart-factory-backend` | [DruHustle/smart-factory-backend](https://github.com/DruHustle/smart-factory-backend) | `main` |
| Factory gateway and firmware | `smart-factory-edge` | [DruHustle/smart-factory-edge](https://github.com/DruHustle/smart-factory-edge) | `master` |

## Move existing Mac checkouts

Close development servers and open terminals outside the project directories.
Download the migration script, then run it with Python 3.9 or newer:

```bash
migration_script="$(mktemp -t smart-factory-migration)"
curl --fail --location --proto '=https' --tlsv1.2 \
  https://raw.githubusercontent.com/DruHustle/smart-factory-frontend/main/scripts/migrate-smart-factory.py \
  --output "$migration_script"
python3 "$migration_script" --apply --sync
```

Omit `--apply` to preview the plan. Use `--github-dir '/absolute/GitHub/path'`
for a different workspace parent. The script identifies each checkout by its
GitHub origin rather than assuming its current directory name is correct.

It moves complete directories, retaining branches, staged and unstaged changes,
untracked files, ignored `.env` files and dependencies. Git worktree links are
repaired. Origin fetch and explicit push URLs are renamed, retaining SSH or HTTPS.
Missing components are cloned; `--no-clone` disables that step. Existing checkouts
are never reset, cleaned, stashed or deleted. Duplicate checkouts and occupied
destinations stop the migration before any move.

The script writes `smart-factory.code-workspace` in the parent and records directory
moves in a private migration journal. Failed directory moves are reversed where
possible; retained staging files and their paths are reported for review.
`--sync` fast-forwards only clean checkouts on their default branch. Changed
checkouts and feature branches retain their current code and need their usual
review/merge before receiving the naming changes. Re-running the script is safe.

## Existing deployed resource identities

Repository and product naming changes do not migrate a running database, Docker
volume, JWT issuer/audience, Pi state directory, or hosting domain. These identifiers
remain compatible with existing data and services. In particular, the current
Vercel URL still contains the former name. Historical deployment manifests and
qualification logs preserve the identities they actually recorded.

New UI titles, reports, email display names, package identity, AutomationML download
names, repository links and sibling-source references use Smart Factory. Before
changing persistent resource identifiers, coordinate their data/configuration
migration and verify the deployed API and worker together.

## Verify

```bash
python3 scripts/migrate-smart-factory.py --github-dir '/Users/andrewgotora/Software Development/GitHub'
python3 -m unittest discover -s scripts/tests -p 'test_smart_factory_migration.py' -v
```

The first command should show every component already in its canonical location.
The tests use disposable repositories and cover dirty files, ignored settings,
duplicate/conflicting checkouts, SSH push URLs, linked worktrees and rollback.
