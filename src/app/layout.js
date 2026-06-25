import "../styles/globals.css";

export const metadata = {
  title: "Drone Detection System",
  description: "Real-time multi-camera drone detection",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}
