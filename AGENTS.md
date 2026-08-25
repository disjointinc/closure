There's a reason files are structured in their current pattern. There's a reason code and architectural choices have been made. It's extremely important to stick to the current structure, unless explicitly told otherwise. Most questions you'll get are "why is this particular line different from the pattern established elsewhere"; preempt that question by sticking to the patterns established elsewhere unless there's a good reason not to.

KISS (keep it simple, stupid). Don't go off into verbose explanations of potential future tangents, just directly address the immediate question at hand and give the necessary info to make a call.

BLUF (bottom line up front). Put the most important information - the conclusion, the key facts, the "so what" - right at the top. Follow with supporting answers in descending order of importance.

Keep diffs minimal. Don't add unnecessary boilerplate unless you're given a strong reason it would be helpful.

When adding dependencies, prefer the most stable, widely adopted alternative. Don't add dependencies unless the need is explicit.

When installing or upgrading dependencies, whether as a dev dependency or a runtime dependency, use the latest version, unless it's in alpha testing, has noted failures from the community, or causes other packages to break. It's worth doing a quick check for these things before installing.

For both dev and runtime dependencies, always specify all 3 parts of the semver and precede with a caret (so we can automatically accept minor and patch version changes).

Don't edit files that have comments specifically saying not to edit because the file is automatically created by a framework.

Whenever possible, use `null` rather than `undefined`.

Whenever possible, use named inputs rather than ordered inputs. Alphabetically order those inputs. Even if a function has only 1 input, the default should be using a named input. The only exception is for throwaway, single-use, lambda functions, or functions that have to take ordered inputs because of how another framework is set up (for example, a queue handler that will be called by an SST AWS queue).

Nested if statements are code smell; please avoid by placing conditions that can lead to a function return first.

Don't add abstractions unless they're covering up significant complexity. We'd rather repeat ourselves and have clarity than have a bunch of obtuse nested helper functions or separate code files. The point of abstractions is to modularize complexity rather than keep file sizes small or ensure DRY code.

Either place components in the file that uses them, or, if they're used by multiple files or are sufficiently complex that they should live in their own file, put them in a `-components` folder at the same top level as the file(s) that use them. Don't do the intermediate solution where components are prefixed with `-` and live at the same top level as the file(s) that use them.

`useRef` is a code smell.

Nested if statements are a code smell. Short circuit to keep code simple.

Choose the right ID for the right job. Every ID should be prefixed with some string that helps humans identify what type of ID it is when it shows up in some logs (i.e. prefix user IDs with `u_`, workspace IDs with `w_`, etc). The general preference should be for IDs of lowercase letters and numbers. Sometimes, a more complex ID structure may be necessary (for example, a snowflake ID when dealing with time access read / insert conditions), but whenever possible, pick the ID structure that respects performance requirements while being optimally human-readable.

If you think it should be a boolean in the DB, it should almost always be a timestamp. For example, "deleted" is a bad boolean to add - "deleted_at" is generally much better because it conveys richer information for minimal cost.

All else being equal, prefer data structures that don't delete old data over ones that do. For example, unless there's a reason to delete old data in a table, it's generally better to have a `deleted_at` field rather than actually delete rows in the table.

Typecasts are a code smell.

Don't add comments explaining logic that should be clear from the code or common conventions. Only add comments when linking to hard-to-find documentation or explaining non-obvious or easily footgun-able architectural thinking. Don't tie comments to swappable changes (for example, including a hardcoded constant in a comment, or a 3P provider that we may swap out). Instead, reference the actual values in the comments (MY_CONSTANT rather than 5, observability provider rather than PostHog, etc).

Do things correctly. Running a timer? Do a deadline rather than increments, which introduce per-tick deltas. Making a bunch of calls with an exponential backoff? Introduce randomness if thundering herd could be an issue. Even if something is a simple function, do it right from the start. Apply this rule within reason, of course; don't go overboard with wildly complex solutions.

If a comment is multiline, use the multiline syntax rather than prefixing // on every line.

All API routes should (1) be RESTful and (2) validate inputs. Except for a handful of unique, explicitly public routes, all API routes should (1) require authentication and (2) set reasonable rate limits.

Write code defensively. That is, include default guards on switch statements, even if all cases are covered. Write for loops with sane limits, rather than while loops, in case there's some unconsidered case that could lead to an infinite loop.

Log all errors, even if they should never occur in a try-catch block. Log anything that might be an interesting metric or provide important signals. If in doubt - log it.

Don't use magic numbers. Use constants.
