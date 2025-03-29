import "./globals.css"

export const metadata = {
  title: "Be My Eyes",
  description: "A speech capture application",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
