import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './hooks/useAuth.jsx';
import { Layout } from './components/Layout.jsx';
import { NewPaste } from './routes/NewPaste.jsx';
import { ViewPaste } from './routes/ViewPaste.jsx';
import { SignIn } from './routes/SignIn.jsx';
import { MyPastes } from './routes/MyPastes.jsx';
import { NotFound } from './routes/NotFound.jsx';

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<NewPaste />} />
            <Route path="p/:slug" element={<ViewPaste />} />
            <Route path="signin" element={<SignIn />} />
            <Route path="mine" element={<MyPastes />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
