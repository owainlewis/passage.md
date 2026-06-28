import Editor from "../editor";
import { AuthProvider } from "../auth";
import { EntitlementsProvider } from "../entitlements";

export default function Write() {
  return (
    <AuthProvider>
      <EntitlementsProvider>
        <Editor />
      </EntitlementsProvider>
    </AuthProvider>
  );
}
