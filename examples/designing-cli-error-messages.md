---
title: "Designing CLI Error Messages: A Practical Guide"
slug: designing-cli-error-messages
description: "Design CLI error messages people can act on: what→why→fix structure, stderr vs stdout, exit codes, NO_COLOR, and remediation for internal tools."
excerpt: A good CLI error tells you what happened, why, and what to do next, and it still works in pipes and CI. Here is a practical pattern for senior engineers building internal tools.
keyword: designing cli error messages
category: CLI Design
author: Hasaam
date: 2026-09-29
sources:
  - url: https://clig.dev
    title: Command Line Interface Guidelines
  - url: https://bettercli.org/design/exit-codes/
    title: Exit codes - Better CLI
  - url: https://no-color.org
    title: NO_COLOR
---

Your tool failed, and the engineer staring at the terminal now has to guess why. Maybe it's a permission problem, maybe an expired token, maybe a bug in your code. If your error message doesn't tell them which, they will ping you on Slack, and you'll answer the same question for the fortieth time.

## What makes a CLI error message good?

An error is the moment your tool gets read most carefully. Nobody skims a failure that just blocked their deploy. Treat error output as UI, with the same care you'd give a `--help` screen.

The standard that holds up in both terminals and CI is simple: say what happened, why it happened, and how to fix it. Optionally, add a stable error code and a docs URL. That structure, [as clig.dev lays out](https://clig.dev), works for a human reading the terminal and for someone grepping CI logs at 2 a.m.

Here's a typical before:

```
Error: EACCES
```

And the after, [modeled on clig.dev's own example](https://clig.dev):

```
Can't write to file.txt. You might need to make it writable by running 'chmod +w file.txt'.
```

The second version names the file, implies the cause, and hands over the exact command. The user can copy, paste, and move on.

## Catch expected errors and rewrite them for humans

Bad input, missing files, denied permissions, and expired credentials aren't bugs. They're expected failures, and [clig.dev says to rewrite them for humans](https://clig.dev). A 30-line Python traceback for a typo in a flag is a failure of your tool, not the user.

Include the specifics you already have. Print the path you tried to open, the value you rejected, and the constraint it violated. Compare these two:

- `Invalid config`
- `config.yaml line 14: 'replicas' must be between 1 and 50, got 200`

The cleanest way to enforce this is a single catch at the top of your entrypoint that maps known exception types to messages:

```python
KNOWN = {
    FileNotFoundError: lambda e: f"Can't find {e.filename}. Check the path or run 'deployctl init'.",
    PermissionError:   lambda e: f"Can't write to {e.filename}. Try 'chmod +w {e.filename}'.",
    AuthExpired:       lambda e: "Your session expired. Run 'deployctl login' and retry.",
}

def main():
    try:
        run(sys.argv[1:])
    except tuple(KNOWN) as e:
        print(KNOWN[type(e)](e), file=sys.stderr)
        sys.exit(1)
```

Anything not in the map falls through to your unexpected-error handler, covered below.

## Keep signal high: grouping, ordering and restraint

[Signal-to-noise ratio is crucial](https://clig.dev). If your linter finds the same missing field in 40 files, don't print 40 near-identical lines. Print one header explaining the problem, then list the files under it.

Put the most important information at the end of the output. That's where the eye lands when the command returns and the prompt reappears. The fix command belongs on the last line, not buried above a wall of context.

Skip `ERR` and `WARN` prefixes in human-facing output. They add visual noise without adding meaning, since the message itself should make severity obvious. Reserve level labels for verbose or log modes where they help filtering.

Use red for the one line that matters, if at all. When everything is red, nothing is.

## Send errors to stderr and get exit codes right

Errors, warnings, and logs go to stderr. Stdout is for data. If you print `Error: not found` to stdout, it ends up piped into `jq` or written into someone's output file, and they'll debug the wrong problem. [clig.dev is explicit on this](https://clig.dev).

Exit 0 on success and non-zero on failure. That part isn't negotiable, since every shell `&&`, every `set -e`, and every CI step depends on it.

How many non-zero codes to use is where sources disagree. [clig.dev suggests](https://clig.dev) mapping distinct codes to your important failure modes. [Better CLI recommends](https://bettercli.org/design/exit-codes/) sticking to 0 and 1 unless you have a strong reason for more.

My recommendation: default to 0/1. Add a small set of mapped codes only when scripts genuinely need to branch on them. For example:

- `2`: usage error (don't retry)
- `3`: transient failure (safe to retry)
- `4`: resource already exists (safe to skip)

Whatever you choose, document it in `--help` or the man page. An undocumented exit code is just a number someone has to reverse-engineer.

## Color and formatting that don't break logs and CI

ANSI escape codes in a CI log look like `\x1b[31m` garbage around every error. [Per clig.dev](https://clig.dev), disable color when any of these is true:

- The stream isn't a TTY (check stderr separately from stdout)
- `NO_COLOR` is set
- `TERM=dumb`
- The user passed `--no-color`

The [NO_COLOR convention](https://no-color.org) is precise: if the variable is present and non-empty, don't emit ANSI color, whatever its value. It covers color only, not bold or underline. User config files or explicit flags can override it. It's supported by hundreds of libraries and tools, so your users probably already have it set.

Even with color enabled, restraint wins. One colored line per error is plenty.

## Handle unexpected errors: debug output and bug reports

Unexpected errors are the ones your top-level map didn't catch, which means they're probably your bug. The user still needs a path forward.

Keep debug output behind `-v`, `-d`, or `--debug`. Don't dump it by default. For crashes, [clig.dev recommends](https://clig.dev) writing the traceback and context to a log file and pointing the user at it:

```
deployctl hit an unexpected error. Details saved to ~/.deployctl/logs/crash-20260928-1412.log

Please report it: https://github.com/acme/deployctl/issues/new?title=Crash+in+deploy&body=version%3A+2.4.1%0Aos%3A+darwin-arm64
```

The pre-populated issue URL is the part most tools skip. Filling in version, OS, and the failing command means you get useful reports instead of "it broke."

## Error messages for internal tools: point at your own runbook

This section is recommendation from experience, not a published standard. Internal tools have an advantage public CLIs don't: you know exactly who owns every failure mode and where the fix is documented. Put that in the message.

Three things pay off fast:

- **Exact auth commands.** Not "authenticate and try again," but `Run 'vault login -method=oidc' then retry`.
- **Runbook links.** `See https://wiki.acme.internal/runbooks/deploy-quota`.
- **Owning channel.** `Still stuck? Ask in #platform-deploy`.

Add a stable error code to each known failure, like `DEPLOY-E042`, alongside the docs URL. Codes survive copy-paste into Slack, and your support channel can search for them. Keep them stable across versions, because old runbooks and old threads will reference them.

## Checklist: ship-ready CLI error messages

- [ ] Every expected error says what happened, why, and how to fix it
- [ ] Messages include real paths, values, and constraints
- [ ] Errors go to stderr; stdout stays clean for data
- [ ] Exit 0 on success, non-zero on failure, extra codes documented
- [ ] Color off for non-TTY, `NO_COLOR`, `TERM=dumb`, and `--no-color`
- [ ] Repeated errors grouped under one header
- [ ] Fix command on the last line
- [ ] Debug output behind `--debug`; crashes written to a log file
- [ ] Bug-report URL pre-filled with version and OS
- [ ] Internal tools: runbook link, owning channel, stable error code

## FAQ

### What should a good CLI error message include?

What happened, why it happened, and how to fix it, ideally with the exact command to run. Optionally add a stable error code and a docs URL, [per clig.dev](https://clig.dev).

### Should CLI errors go to stdout or stderr?

Stderr. Stdout is for data that might be piped into another program, and error text there corrupts that output.

### How many exit codes should my CLI use?

Start with 0 for success and 1 for failure, [as Better CLI recommends](https://bettercli.org/design/exit-codes/). Add a few mapped codes only when scripts need to branch, such as retry versus skip, and document them.

### How do I handle NO_COLOR and non-TTY output in error messages?

Disable color when the stream isn't a TTY, `NO_COLOR` is set to any non-empty value, `TERM=dumb`, or `--no-color` is passed. [NO_COLOR](https://no-color.org) covers color only, not bold or underline.

### Should I show stack traces in CLI errors?

Not for expected failures. For unexpected ones, write the trace to a log file or show it under `--debug`, and give the user a bug-report link.

### How do I add error codes or docs links to CLI errors?

Assign each known failure a stable code like `DEPLOY-E042` and print it with a URL to its docs page. Keep codes unchanged across releases so old links and searches keep working.
