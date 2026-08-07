import './globals.css';

export const metadata = {
  title: 'LE MAMBO — Original Night Bar',
  description: 'LE MAMBO, bar de nuit à Condé-en-Normandie. Soirées, animations, cocktails et ambiance jusqu’au bout de la nuit.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
