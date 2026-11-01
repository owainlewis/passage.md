// The hosted MCP endpoint agents connect to, shown on the agents and account pages.
export const MCP_URL = "https://passage.md/mcp";

export function claudeCodeCommand(token = "psg_...") {
  return `claude mcp add --transport http passage ${MCP_URL} --header "Authorization: Bearer ${token}"`;
}
