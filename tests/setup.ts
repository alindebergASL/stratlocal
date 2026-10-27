// A fresh in-memory database before every test, everywhere.
//
// Thirteen test files opened with the same hand-copied
// `beforeEach(() => resetDbForTests())` and eight more had none, because they
// happened not to touch the database. That is a convention with nothing
// enforcing it, and the cost of forgetting is a test that passes or fails
// depending on which ones ran before it — the kind of failure that gets
// re-run rather than read.
//
// The explicit calls stay where they are: several of them reset mid-test on
// purpose, and the ones in a beforeEach say locally what the file expects.
// This runs first and makes the guarantee unconditional.
import { beforeEach } from "vitest";
import { resetDbForTests } from "@/lib/db";

beforeEach(() => {
  resetDbForTests();
});
