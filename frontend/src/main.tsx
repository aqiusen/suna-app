import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ToastProvider } from "./components/ui/Toast";
import { TooltipProvider } from "./components/ui/Tooltip";
import { bindDesktopUnloadShutdown } from "./lib/gatewayShutdown";

bindDesktopUnloadShutdown();

const root = document.getElementById("root");
if (root === null) throw new Error("missing root element");

createRoot(root).render(
  <StrictMode>
    <TooltipProvider>
      <ToastProvider>
        <App />
      </ToastProvider>
    </TooltipProvider>
  </StrictMode>,
);
