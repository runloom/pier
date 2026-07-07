import { useEffect, useState } from "@pier/plugin-api/react";
import { jsx, jsxs } from "@pier/plugin-api/jsx-runtime";
//#region src/renderer/accounts-widget.tsx
function AccountsWidget({ context }) {
	const [snapshot, setSnapshot] = useState(null);
	useEffect(() => {
		let currentRevision = 0;
		const unsubscribe = context.rpc.on("accounts.changed", (event) => {
			if (event.revision > currentRevision) {
				currentRevision = event.revision;
				setSnapshot(event);
			}
		});
		context.rpc.invoke("accounts.snapshot", null).then((initial) => {
			if (initial.revision > currentRevision) {
				currentRevision = initial.revision;
				setSnapshot(initial);
			}
		}).catch(() => {});
		return unsubscribe;
	}, [context]);
	if (!snapshot) return /* @__PURE__ */ jsx("div", { children: "Codex accounts loading" });
	return /* @__PURE__ */ jsxs("div", { children: [
		/* @__PURE__ */ jsx("h4", { children: "Codex Accounts" }),
		snapshot.accounts.length === 0 ? /* @__PURE__ */ jsx("p", { children: "No accounts yet." }) : /* @__PURE__ */ jsx("ul", { children: snapshot.accounts.map((account) => /* @__PURE__ */ jsxs("li", { children: [
			account.label,
			" (",
			account.status,
			")",
			account.id === snapshot.activeAccountId && " · active"
		] }, account.id)) }),
		/* @__PURE__ */ jsx("button", {
			onClick: () => {
				context.rpc.invoke("accounts.refreshUsage", null).catch(() => {});
			},
			type: "button",
			children: "Refresh usage"
		})
	] });
}
//#endregion
//#region src/renderer/index.tsx
var plugin = {
	id: "pier.codex",
	activate(context) {
		return context.dashboardWidgets.register({
			id: "pier.codex.accounts",
			title: () => "Codex Accounts",
			component: (_props) => AccountsWidget({ context })
		});
	}
};
//#endregion
export { AccountsWidget, plugin };
