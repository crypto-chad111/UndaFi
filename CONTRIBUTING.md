# Contributing to UndaFi

Thanks for wanting to help. UndaFi is a hobby project, so please expect slow
replies, and sometimes none.

## How to contribute

1. Fork the repository and make your change on a branch in your fork.
2. Run `npm test`. Every check must pass.
3. Open a pull request against `main` and say what you changed and how you
   tested it.

Nobody can push to `main` directly. Every change goes through a pull request
that the maintainer reviews.

## What makes a change easy to accept

- **Keep it honest.** UndaFi tells people plainly what it cannot do. Do not
  add wording, visuals or defaults that suggest more accuracy, coverage or
  security than was measured.
- **Say what was tested.** "Tested on a Windows 11 PC with an Intel AX201
  card" is useful. "Should work" is not. Untested is fine if you say so.
- **No new dependencies** unless there is no reasonable way without one. The
  app runs with Node.js alone, and that is a feature.
- **Stay local.** Nothing may leave the user's home network except the
  alerts they switched on.
- **Keep old data working.** A newer version must still read the `data`
  folder an older version wrote.
- **Add a test** for behaviour you add or fix.

## Especially welcome

- Reports of how UndaFi behaves on your WiFi card (model, what the readings
  panel showed, the walk test result).
- macOS and better Linux support.
- The ESP32-S3 sensor boards described in the README.

## Please do not include

- Passwords, tokens, ntfy topic names, or anything from your `data` folder.
- Floor plans or screenshots of a real home with details you would not want
  public.

## Licence of contributions

By opening a pull request you agree that your contribution is licensed under
the Apache License 2.0, the same as the rest of UndaFi.
