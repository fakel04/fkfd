import type { Metadata, Viewport } from 'next';
import './globals.css';
import './keep-theme.css';
import './access.css';
import './offline.css';
export const metadata: Metadata={
 title:'Облака — задачи и заметки',
 description:'Свободное место для мыслей, заметок и дел. Собирайте задачи в облака и расставляйте всё по-своему.',
 applicationName:'Облака',
 appleWebApp:{capable:true,title:'Облака',statusBarStyle:'default'},
 other:{'apple-mobile-web-app-capable':'yes'},
 icons:{
  icon:[{url:'/favicon.ico',sizes:'16x16 32x32 48x48',type:'image/x-icon'},{url:'/icons/oblaka-32.png',sizes:'32x32',type:'image/png'}],
  apple:[{url:'/apple-touch-icon.png',sizes:'180x180',type:'image/png'}]
 }
};
export const viewport: Viewport={width:'device-width',initialScale:1,themeColor:'#ffffff',viewportFit:'cover'};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="ru"><head>{/* Behind Cloudflare Access the manifest needs the sign-in cookie. */}<link rel="manifest" href="/site.webmanifest" crossOrigin="use-credentials"/></head><body>{children}</body></html>}
