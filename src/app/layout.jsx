import '../app/globals.css';

export const metadata = {
  title: 'Telemedicine Rural Care',
  description: 'Rural telemedicine platform powered by Next.js, Supabase, and Azure Blob Storage.'
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
