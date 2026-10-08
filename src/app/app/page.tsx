import { Dashboard } from "@/components/Dashboard";
import { Aurora } from "@/components/Aurora";
export default function WorkspacePage() {
  return (
    <main id="main-content" className="app-main">
      <Aurora className="workspace-aurora" />
      <Dashboard />
    </main>
  );
}
