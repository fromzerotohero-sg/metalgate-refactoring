import { Suspense } from "react";
import ChatInbox from "@/src/components/admin/chat/chat-inbox";

export default function ChatPage() {
  return (
    <Suspense fallback={<p className="admin-loading">Caricamento…</p>}>
      <ChatInbox />
    </Suspense>
  );
}
