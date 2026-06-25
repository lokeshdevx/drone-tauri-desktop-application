"use client";
import { Toaster } from "sonner";
import Sidebar from "./Sidebar";
import Header from "./Header";
import Dashboard from "./pages/Dashboard";
import CamerasPage from "./pages/CamerasPage";
import GalleryPage from "./pages/GalleryPage";
import LogsPage from "./pages/LogsPage";
import SettingsPage from "./pages/SettingsPage";
import AboutPage from "./pages/AboutPage";
import AddCameraModal from "./AddCameraModal";
import { useUIStore } from "@/store";
import { useDetectionEngine } from "@/lib/detection-engine";

const PAGES = {
  dashboard: Dashboard,
  cameras: CamerasPage,
  gallery: GalleryPage,
  logs: LogsPage,
  settings: SettingsPage,
  about: AboutPage,
};

export default function AppShell() {
  useDetectionEngine();

  const page = useUIStore((s) => s.page);
  const addCameraOpen = useUIStore((s) => s.addCameraOpen);

  const Page = PAGES[page] || Dashboard;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <Sidebar />

      <div className="flex flex-col flex-1 overflow-hidden min-w-0">
        <Header />
        <main className="flex-1 overflow-auto">
          <Page />
        </main>
      </div>

      {addCameraOpen && <AddCameraModal />}
      <Toaster position="bottom-right" richColors closeButton />
    </div>
  );
}
