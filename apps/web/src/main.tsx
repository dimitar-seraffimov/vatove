import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "maplibre-gl/dist/maplibre-gl.css";
import App from "./App";
import { TooltipProvider } from "./context/TooltipContext";
import { MapProvider } from "./map/MapProvider";
import { registerServiceWorker } from "./pwa/register";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root application mount point");

createRoot(root).render(
  <BrowserRouter>
    <TooltipProvider>
      <MapProvider>
        <App />
      </MapProvider>
    </TooltipProvider>
  </BrowserRouter>,
);

registerServiceWorker();
