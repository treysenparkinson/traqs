// One context per request, so "who is doing this" can't leak between requests.
//
// withRequest(handler) runs each invocation inside its own AsyncLocalStorage context. auth.js
// records the caller into it (setActor in store/select.js) and the Postgres store reads it for
// change_log. Without this boundary, AsyncLocalStorage.enterWith set the actor on whatever
// context happened to be current, and a later or concurrent request (a kiosk clock-in with no
// token) inherited the previous caller: wrong attribution in an audit log is worse than none.
// Outside a request (scripts, tests that call handlers bare) there is no context and the actor
// stays unset.

import { AsyncLocalStorage } from "node:async_hooks";

export const requestContext = new AsyncLocalStorage();

export function withRequest(handler) {
  return (event, context) => requestContext.run({ actor: null }, () => handler(event, context));
}
