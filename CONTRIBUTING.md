# Contributing

Thanks for helping out. Please read the licensing terms below before opening a
pull request — they matter more than usual for this project.

## Inbound license (please read)

This project is licensed under **FSL-1.1-ALv2** (see [LICENSE](./LICENSE)).

By submitting a contribution — a pull request, patch, issue with code in it, or
any other work — you agree to the following:

1. **You have the right to contribute it.** The work is yours, or you have
   permission to submit it. If you are contributing on behalf of an employer,
   you confirm you have authorization to do so and that your employer will not
   assert rights over the contribution.

2. **You grant a broad license to the project maintainer.** You grant Rushil
   Chopra a perpetual, worldwide, non-exclusive, royalty-free, irrevocable
   license to use, reproduce, modify, distribute, sublicense, and relicense
   your contribution — including under different license terms — as part of
   this project or any derivative of it. You retain copyright in your
   contribution.

3. **You grant a patent license.** You grant a perpetual, worldwide,
   non-exclusive, royalty-free, irrevocable patent license covering any patent
   claims you own that are necessarily infringed by your contribution.

4. **No warranty.** Contributions are provided as-is.

Why point 2 exists: without a relicensing grant, every outside contributor
becomes a veto on future license changes (including moving to a more permissive
license). It is not a copyright assignment — you keep ownership of your work.

If your organization needs a signed agreement instead of this in-repo notice,
open an issue and we'll sort out a formal CLA before you send code.

## Practical stuff

- Open an issue before large changes so we can agree on the approach.
- Run `npx tsc --noEmit` and `npm run lint` before pushing.
- **Never commit secrets.** `.env*` is gitignored; keep it that way. If a key
  is ever committed, rotate it immediately — removing it from the diff is not
  enough.
- Document any new environment variable in `.env.example` and `SETUP.md`.
- Do not add dependencies with copyleft licenses (GPL, AGPL, LGPL, SSPL)
  without flagging it in the PR description. See
  [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md).
