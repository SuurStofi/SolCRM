import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next 16 rewrites AGENTS.md / CLAUDE.md on every dev run. The content is
  // generic Next boilerplate -- it frames the project as a customised fork
  // with breaking API changes and points at docs inside node_modules -- so it
  // misleads anyone who trusts it, and it is not this project's own guidance.
  agentRules: false,
};

export default nextConfig;
