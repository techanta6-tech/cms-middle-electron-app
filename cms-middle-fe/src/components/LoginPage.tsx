import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Button,
  TextField,
  Typography,
  Paper,
  Container,
  Alert,
  InputAdornment,
  IconButton,
  Accordion,
  AccordionSummary,
  AccordionDetails
} from '@mui/material';
import { Lock, Mail, Eye, EyeOff, ShieldCheck, ChevronDown, Server, CheckCircle2, XCircle } from 'lucide-react';
import { authApi } from '../api/authApi';
import { updateApiClientBaseUrl } from '../api/apiClient';
import { socket, updateSocketUrlAsync, getBeHost, getBePort } from '../socket';
import { useNavigate } from 'react-router-dom';

declare const __APP_VERSION__: string;

const LoginPage: React.FC = () => {
  const { t } = useTranslation();
  const [email, setEmail] = useState(import.meta.env.VITE_DEV_ACCOUNT || '');
  const [password, setPassword] = useState(import.meta.env.VITE_DEV_PASSWORD || '');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const [beHost, setBeHost] = useState(getBeHost());
  const [bePort, setBePort] = useState(getBePort());
  const [beStatus, setBeStatus] = useState<'checking' | 'connected' | 'disconnected'>('checking');

  useEffect(() => {
    const onConnect = () => setBeStatus('connected');
    const onDisconnect = () => setBeStatus('disconnected');

    setBeStatus(socket.connected ? 'connected' : 'disconnected');

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, []);

  const handleSaveConnection = async () => {
    setBeStatus('checking');
    localStorage.setItem('BE_HOST', beHost);
    localStorage.setItem('BE_PORT', bePort);
    updateApiClientBaseUrl();
    const success = await updateSocketUrlAsync(`http://${beHost}:${bePort}`);
    setBeStatus(success ? 'connected' : 'disconnected');
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const result = await authApi.login(email, password);
    if (result.success) {
      if (socket.connected) {
        socket.emit('request-sync');
      }
      navigate('/dashboard');
    } else {
      setError(result.message || t('app.login.error'));
    }
    setLoading(false);
  };

  return (
    <Box
      className="login-page-root"
      sx={{
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
        position: 'relative',
        overflow: 'hidden'
      }}
    >
      {/* Decorative elements */}
      <Box sx={{
        position: 'absolute', top: '-10%', left: '-10%',
        width: '40%', height: '40%',
        background: 'radial-gradient(circle, rgba(56, 189, 248, 0.1) 0%, transparent 70%)',
        zIndex: 0
      }} />
      <Box sx={{
        position: 'absolute', bottom: '-10%', right: '-10%',
        width: '40%', height: '40%',
        background: 'radial-gradient(circle, rgba(139, 92, 246, 0.1) 0%, transparent 70%)',
        zIndex: 0
      }} />

      <Container maxWidth="xs" sx={{ zIndex: 1 }} className="login-container">
        <Paper
          className="login-paper"
          elevation={24}
          sx={{
            p: 4,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            borderRadius: 4,
            background: 'rgba(30, 41, 59, 0.7)',
            backdropFilter: 'blur(20px)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
          }}
        >
          <Box
            sx={{
              mb: 3,
              p: 2,
              borderRadius: '50%',
              background: 'rgba(56, 189, 248, 0.1)',
              border: '1px solid rgba(56, 189, 248, 0.2)',
              display: 'flex'
            }}
          >
            <ShieldCheck size={32} color="#38bdf8" />
          </Box>

          <Typography component="h1" variant="h4" sx={{ textAlign: 'center', mb: 1, fontWeight: 800, color: '#f8fafc', letterSpacing: -0.5 }}>
            {t('app.login.title')}
          </Typography>
          <Typography variant="body2" sx={{ textAlign: 'center', mb: 4, color: '#94a3b8', }}>
            {t('app.login.authorized_personnel')}
          </Typography>

          {error && (
            <Alert severity="error" sx={{ width: '100%', mb: 3, borderRadius: 2 }}>
              {error}
            </Alert>
          )}

          <Box component="form" onSubmit={handleLogin} sx={{ width: '100%' }} className="login-form">
            <TextField
              className="login-email-input"
              margin="normal"
              required
              fullWidth
              id="email"
              label={t('app.login.username')}
              name="email"
              autoComplete="email"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <Mail size={20} color="#94a3b8" />
                  </InputAdornment>
                ),
              }}
              sx={{
                '& .MuiOutlinedInput-root': {
                  color: '#f8fafc',
                  '& fieldset': { borderColor: 'rgba(255, 255, 255, 0.1)' },
                  '&:hover fieldset': { borderColor: '#38bdf8' },
                  backgroundColor: 'rgba(15, 23, 42, 0.3)'
                },
                '& .MuiInputLabel-root': { color: '#94a3b8' }
              }}
            />
            <TextField
              className="login-password-input"
              margin="normal"
              required
              fullWidth
              name="password"
              label={t('app.login.password')}
              type={showPassword ? 'text' : 'password'}
              id="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <Lock size={20} color="#94a3b8" />
                  </InputAdornment>
                ),
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton onClick={() => setShowPassword(!showPassword)} edge="end" sx={{ color: '#94a3b8' }}>
                      {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                    </IconButton>
                  </InputAdornment>
                )
              }}
              sx={{
                '& .MuiOutlinedInput-root': {
                  color: '#f8fafc',
                  '& fieldset': { borderColor: 'rgba(255, 255, 255, 0.1)' },
                  '&:hover fieldset': { borderColor: '#38bdf8' },
                  backgroundColor: 'rgba(15, 23, 42, 0.3)'
                },
                '& .MuiInputLabel-root': { color: '#94a3b8' }
              }}
            />
            <Button
              className="login-submit-button"
              type="submit"
              fullWidth
              variant="contained"
              disabled={loading}
              sx={{
                mt: 4,
                mb: 2,
                py: 1.5,
                borderRadius: 2,
                fontWeight: 700,
                fontSize: '1rem',
                textTransform: 'none',
                background: 'linear-gradient(90deg, #38bdf8 0%, #8b5cf6 100%)',
                boxShadow: '0 10px 15px -3px rgba(56, 189, 248, 0.3)',
                '&:hover': {
                  background: 'linear-gradient(90deg, #0ea5e9 0%, #7c3aed 100%)',
                }
              }}
            >
              {loading ? t('app.login.authenticating') : t('app.login.login_btn')}
            </Button>
          </Box>

          <Accordion
            className="login-backend-config"
            sx={{
              width: '100%',
              background: 'rgba(15, 23, 42, 0.4)',
              color: '#94a3b8',
              boxShadow: 'none',
              border: '1px solid rgba(255, 255, 255, 0.05)',
              borderRadius: '8px !important',
              '&:before': { display: 'none' }
            }}
          >
            <AccordionSummary
              expandIcon={<ChevronDown size={18} color="#94a3b8" />}
              aria-controls="panel-content"
              id="panel-header"
              sx={{ minHeight: '48px', '& .MuiAccordionSummary-content': { my: 1 } }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, width: '100%' }}>
                <Server size={18} />
                <Typography variant="body2" sx={{ fontWeight: 600, flex: 1 }}>{t('app.login.connection_settings')}</Typography>
                {beStatus === 'checking' && <Typography variant="caption" sx={{ color: '#cbd5e1' }}>{t('app.login.checking')}</Typography>}
                {beStatus === 'connected' && <CheckCircle2 size={16} color="#22c55e" />}
                {beStatus === 'disconnected' && <XCircle size={16} color="#ef4444" />}
              </Box>
            </AccordionSummary>
            <AccordionDetails sx={{ pt: 0, pb: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <TextField
                  size="small"
                  label={t('app.login.host_ip')}
                  value={beHost}
                  onChange={(e) => setBeHost(e.target.value)}
                  sx={{
                    flex: 2,
                    '& .MuiOutlinedInput-root': { color: '#f8fafc', '& fieldset': { borderColor: 'rgba(255, 255, 255, 0.1)' } },
                    '& .MuiInputLabel-root': { color: '#94a3b8' }
                  }}
                />
                <TextField
                  size="small"
                  label={t('app.login.port')}
                  value={bePort}
                  onChange={(e) => setBePort(e.target.value)}
                  sx={{
                    flex: 1,
                    '& .MuiOutlinedInput-root': { color: '#f8fafc', '& fieldset': { borderColor: 'rgba(255, 255, 255, 0.1)' } },
                    '& .MuiInputLabel-root': { color: '#94a3b8' }
                  }}
                />
              </Box>
              <Button
                variant="outlined"
                size="small"
                onClick={handleSaveConnection}
                disabled={beStatus === 'checking'}
                sx={{
                  color: '#38bdf8',
                  borderColor: 'rgba(56, 189, 248, 0.3)',
                  '&:hover': { borderColor: '#38bdf8', background: 'rgba(56, 189, 248, 0.1)' }
                }}
              >
                {t('app.login.save_apply')}
              </Button>
            </AccordionDetails>
          </Accordion>
        </Paper>
        <Typography variant="body2" sx={{ mt: 4, color: '#475569', textAlign: 'center' }}>
          &copy; {new Date().getFullYear()} CMS DEMO V.{__APP_VERSION__}
        </Typography>
      </Container>

    </Box>
  );
};

export default LoginPage;
