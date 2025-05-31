const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Pentru servirea fișierelor statice

// Calea către fișierul de date
const DATA_FILE = path.join(__dirname, 'data', 'bookings.json');

// Credentiale admin (în producție ar trebui să fie în variabile de mediu)
const ADMIN_CREDENTIALS = {
    username: 'admin',
    password: 'barbershop2024'
};

// Stocarea token-urilor active (în producție ar trebui să fie în Redis sau baza de date)
const activeTokens = new Map();

// Asigură-te că directorul data și public există
async function ensureDirectories() {
    const dataDir = path.dirname(DATA_FILE);
    const publicDir = path.join(__dirname, 'public');

    try {
        await fs.access(dataDir);
    } catch (error) {
        await fs.mkdir(dataDir, { recursive: true });
    }

    try {
        await fs.access(publicDir);
    } catch (error) {
        await fs.mkdir(publicDir, { recursive: true });
    }
}

// Încarcă rezervările din fișier
async function loadBookings() {
    try {
        const data = await fs.readFile(DATA_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        // Dacă fișierul nu există, returnează un obiect gol
        return {};
    }
}

// Salvează rezervările în fișier
async function saveBookings(bookings) {
    await ensureDirectories();
    await fs.writeFile(DATA_FILE, JSON.stringify(bookings, null, 2));
}

// Generează token unic
function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

// Validează datele de intrare
function validateBookingData(data, isUpdate = false) {
    const { date, time, name, phone } = data;

    if (!date || !time || !name || !phone) {
        return { valid: false, message: 'Toate câmpurile sunt obligatorii' };
    }

    // Validează formatul datei
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
        return { valid: false, message: 'Format de dată invalid' };
    }

    // Validează ora
    const validTimes = ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00'];
    if (!validTimes.includes(time)) {
        return { valid: false, message: 'Ora selectată nu este validă' };
    }

    // Pentru update-uri din admin, nu validăm data în trecut
    if (!isUpdate) {
        // Validează că data nu este în trecut (doar pentru rezervări noi)
        const selectedDate = new Date(date);
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        if (selectedDate < today) {
            return { valid: false, message: 'Nu se pot face rezervări pentru date trecute' };
        }
    }

    // Validează numele (minim 2 caractere)
    if (name.trim().length < 2) {
        return { valid: false, message: 'Numele trebuie să aibă minim 2 caractere' };
    }

    // Validează numărul de telefon (format simplu)
    const phoneRegex = /^[0-9+\-\s()]{10,15}$/;
    if (!phoneRegex.test(phone.replace(/\s/g, ''))) {
        return { valid: false, message: 'Numărul de telefon nu este valid' };
    }

    return { valid: true };
}

// Middleware pentru verificarea autentificării admin
function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
            message: 'Token de autentificare lipsă',
            success: false
        });
    }

    const token = authHeader.split(' ')[1];

    if (!activeTokens.has(token)) {
        return res.status(401).json({
            message: 'Token invalid sau expirat',
            success: false
        });
    }

    // Verifică dacă token-ul a expirat (24 ore)
    const tokenData = activeTokens.get(token);
    if (Date.now() - tokenData.createdAt > 24 * 60 * 60 * 1000) {
        activeTokens.delete(token);
        return res.status(401).json({
            message: 'Token expirat',
            success: false
        });
    }

    next();
}

// Test route pentru debugging
app.get('/test', (req, res) => {
    res.json({
        message: 'Server is running',
        timestamp: new Date().toISOString(),
        activeTokens: activeTokens.size
    });
});

// Rută pentru pagina de admin
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Rute API

// POST /api/admin/login - Autentificare admin
app.post('/api/admin/login', (req, res) => {
    console.log('Login attempt received:', { username: req.body.username });

    try {
        const { username, password } = req.body;

        // Verifică dacă datele au fost trimise
        if (!username || !password) {
            console.log('Missing credentials');
            return res.status(400).json({
                message: 'Username și password sunt obligatorii',
                success: false
            });
        }

        // Verifică credentialele
        if (username === ADMIN_CREDENTIALS.username && password === ADMIN_CREDENTIALS.password) {
            // Generează token nou
            const token = generateToken();

            // Stochează token-ul
            activeTokens.set(token, {
                username,
                createdAt: Date.now()
            });

            console.log('Login successful, token generated');
            res.json({
                message: 'Autentificare reușită',
                token: token,
                success: true
            });
        } else {
            console.log('Invalid credentials');
            res.status(401).json({
                message: 'Credentiale invalide',
                success: false
            });
        }
    } catch (error) {
        console.error('Eroare la autentificare:', error);
        res.status(500).json({
            message: 'Eroare internă a serverului',
            success: false
        });
    }
});

// POST /api/admin/logout - Deconectare admin
app.post('/api/admin/logout', requireAuth, (req, res) => {
    const token = req.headers.authorization.split(' ')[1];
    activeTokens.delete(token);

    res.json({
        message: 'Deconectare reușită',
        success: true
    });
});

// GET /api/bookings/:date - Obține rezervările pentru o dată specifică
app.get('/api/bookings/:date', async (req, res) => {
    try {
        const { date } = req.params;
        const bookings = await loadBookings();

        // Returnează orele rezervate pentru data specificată
        const dayBookings = bookings[date] || [];
        const bookedTimes = dayBookings.map(booking => booking.time);

        res.json(bookedTimes);
    } catch (error) {
        console.error('Eroare la încărcarea rezervărilor:', error);
        res.status(500).json({ message: 'Eroare internă a serverului' });
    }
});

// POST /api/bookings - Creează o rezervare nouă
app.post('/api/bookings', async (req, res) => {
    try {
        const bookingData = req.body;

        // Validează datele
        const validation = validateBookingData(bookingData);
        if (!validation.valid) {
            return res.status(400).json({ message: validation.message });
        }

        const { date, time, name, phone } = bookingData;

        // Încarcă rezervările existente
        const bookings = await loadBookings();

        // Verifică dacă data există în sistem
        if (!bookings[date]) {
            bookings[date] = [];
        }

        // Verifică dacă ora este deja rezervată
        const existingBooking = bookings[date].find(booking => booking.time === time);
        if (existingBooking) {
            return res.status(409).json({ message: 'Ora selectată este deja rezervată' });
        }

        // Creează rezervarea nouă
        const newBooking = {
            id: Date.now().toString() + '-' + Math.random().toString(36).substr(2, 9),
            time,
            name: name.trim(),
            phone: phone.trim(),
            createdAt: new Date().toISOString()
        };

        // Adaugă rezervarea
        bookings[date].push(newBooking);

        // Sortează rezervările după oră
        bookings[date].sort((a, b) => a.time.localeCompare(b.time));

        // Salvează în fișier
        await saveBookings(bookings);

        console.log('New booking created:', newBooking);

        res.status(201).json({
            message: 'Rezervarea a fost confirmată cu succes',
            booking: newBooking,
            success: true
        });

    } catch (error) {
        console.error('Eroare la crearea rezervării:', error);
        res.status(500).json({ message: 'Eroare internă a serverului' });
    }
});

// GET /api/bookings - Obține toate rezervările (pentru administrare)
app.get('/api/bookings', async (req, res) => {
    try {
        const bookings = await loadBookings();
        console.log('Returning all bookings, dates:', Object.keys(bookings));
        res.json(bookings);
    } catch (error) {
        console.error('Eroare la încărcarea rezervărilor:', error);
        res.status(500).json({ message: 'Eroare internă a serverului' });
    }
});

// PUT /api/bookings/:date/:id - Actualizează o rezervare
app.put('/api/bookings/:date/:id', async (req, res) => {
    try {
        const { date, id } = req.params;
        const { newDate, newTime, name, phone } = req.body;

        console.log('Update booking request:', { date, id, newData: req.body });

        // Validează datele noi (permitem update-uri pentru admin)
        const validation = validateBookingData({
            date: newDate,
            time: newTime,
            name,
            phone
        }, true); // true pentru update

        if (!validation.valid) {
            return res.status(400).json({
                message: validation.message,
                success: false
            });
        }

        const bookings = await loadBookings();

        if (!bookings[date]) {
            return res.status(404).json({
                message: 'Nu există rezervări pentru această dată',
                success: false
            });
        }

        const bookingIndex = bookings[date].findIndex(booking => booking.id === id);
        if (bookingIndex === -1) {
            return res.status(404).json({
                message: 'Rezervarea nu a fost găsită',
                success: false
            });
        }

        const booking = bookings[date][bookingIndex];

        // Dacă se schimbă data sau ora, verifică disponibilitatea
        if (newDate !== date || newTime !== booking.time) {
            if (!bookings[newDate]) {
                bookings[newDate] = [];
            }

            const conflictBooking = bookings[newDate].find(b =>
                b.time === newTime && b.id !== id
            );

            if (conflictBooking) {
                return res.status(409).json({
                    message: 'Ora selectată este deja rezervată',
                    success: false
                });
            }
        }

        // Actualizează rezervarea
        const updatedBooking = {
            ...booking,
            time: newTime,
            name: name.trim(),
            phone: phone.trim(),
            updatedAt: new Date().toISOString()
        };

        // Dacă se schimbă data, mută rezervarea
        if (newDate !== date) {
            // Elimină din data veche
            bookings[date].splice(bookingIndex, 1);
            if (bookings[date].length === 0) {
                delete bookings[date];
            }

            // Adaugă la data nouă
            if (!bookings[newDate]) {
                bookings[newDate] = [];
            }
            bookings[newDate].push(updatedBooking);
            bookings[newDate].sort((a, b) => a.time.localeCompare(b.time));
        } else {
            // Actualizează în aceeași dată
            bookings[date][bookingIndex] = updatedBooking;
            bookings[date].sort((a, b) => a.time.localeCompare(b.time));
        }

        await saveBookings(bookings);

        console.log('Booking updated successfully:', updatedBooking);

        res.json({
            message: 'Rezervarea a fost actualizată cu succes',
            booking: updatedBooking,
            success: true
        });

    } catch (error) {
        console.error('Eroare la actualizarea rezervării:', error);
        res.status(500).json({
            message: 'Eroare internă a serverului',
            success: false
        });
    }
});

// DELETE /api/bookings/:date/:id - Șterge o rezervare
app.delete('/api/bookings/:date/:id', async (req, res) => {
    try {
        const { date, id } = req.params;
        console.log('Delete booking request:', { date, id });

        const bookings = await loadBookings();

        if (!bookings[date]) {
            return res.status(404).json({
                message: 'Nu există rezervări pentru această dată',
                success: false
            });
        }

        const bookingIndex = bookings[date].findIndex(booking => booking.id === id);
        if (bookingIndex === -1) {
            return res.status(404).json({
                message: 'Rezervarea nu a fost găsită',
                success: false
            });
        }

        // Șterge rezervarea
        const deletedBooking = bookings[date].splice(bookingIndex, 1)[0];

        // Dacă nu mai sunt rezervări pentru această dată, șterge cheia
        if (bookings[date].length === 0) {
            delete bookings[date];
        }

        await saveBookings(bookings);

        console.log('Booking deleted successfully:', deletedBooking);

        res.json({
            message: 'Rezervarea a fost ștearsă cu succes',
            booking: deletedBooking,
            success: true
        });

    } catch (error) {
        console.error('Eroare la ștergerea rezervării:', error);
        res.status(500).json({
            message: 'Eroare internă a serverului',
            success: false
        });
    }
});

// GET /api/bookings/today - Obține rezervările pentru ziua curentă
app.get('/api/bookings/today', async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const bookings = await loadBookings();
        const todayBookings = bookings[today] || [];

        res.json(todayBookings);
    } catch (error) {
        console.error('Eroare la încărcarea rezervărilor de azi:', error);
        res.status(500).json({ message: 'Eroare internă a serverului' });
    }
});

// GET /api/bookings/week - Obține rezervările pentru săptămâna curentă
app.get('/api/bookings/week', async (req, res) => {
    try {
        const bookings = await loadBookings();
        const today = new Date();
        const weekBookings = {};

        // Generează datele pentru următoarele 7 zile
        for (let i = 0; i < 7; i++) {
            const date = new Date(today);
            date.setDate(today.getDate() + i);
            const dateStr = date.toISOString().split('T')[0];
            weekBookings[dateStr] = bookings[dateStr] || [];
        }

        res.json(weekBookings);
    } catch (error) {
        console.error('Eroare la încărcarea rezervărilor săptămânii:', error);
        res.status(500).json({ message: 'Eroare internă a serverului' });
    }
});

// GET /api/admin/stats - Statistici pentru dashboard
app.get('/api/admin/stats', requireAuth, async (req, res) => {
    try {
        const bookings = await loadBookings();
        const today = new Date().toISOString().split('T')[0];

        // Calculează statistici
        const todayCount = (bookings[today] || []).length;

        // Calculează rezervările săptămânii
        let weekCount = 0;
        const startOfWeek = new Date();
        startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay() + 1);

        for (let i = 0; i < 7; i++) {
            const date = new Date(startOfWeek);
            date.setDate(startOfWeek.getDate() + i);
            const dateStr = date.toISOString().split('T')[0];
            weekCount += (bookings[dateStr] || []).length;
        }

        const totalCount = Object.values(bookings).reduce((sum, dayBookings) => sum + dayBookings.length, 0);

        res.json({
            today: todayCount,
            week: weekCount,
            total: totalCount,
            success: true
        });

    } catch (error) {
        console.error('Eroare la calcularea statisticilor:', error);
        res.status(500).json({
            message: 'Eroare internă a serverului',
            success: false
        });
    }
});

// Middleware pentru gestionarea erorilor
app.use((err, req, res, next) => {
    console.error('Eroare neașteptată:', err);
    res.status(500).json({
        message: 'Eroare internă a serverului',
        success: false
    });
});

// Middleware pentru rute inexistente
app.use((req, res) => {
    console.log('Route not found:', req.method, req.path);
    res.status(404).json({
        message: 'Ruta nu a fost găsită',
        success: false
    });
});

// Pornește serverul
app.listen(PORT, async () => {
    await ensureDirectories();
    console.log(`🚀 Serverul rulează pe portul ${PORT}`);
    console.log(`📋 API disponibil la: http://localhost:${PORT}/api`);
    console.log(`🌐 Frontend disponibil la: http://localhost:${PORT}`);
    console.log(`👤 Admin panel: http://localhost:${PORT}/admin`);
    console.log(`👤 Admin credentiale: username="admin", password="barbershop2024"`);
    console.log(`🔧 Test route: http://localhost:${PORT}/test`);

    // Verifică fișierul de date
    try {
        const bookings = await loadBookings();
        console.log(`📊 Rezervări încărcate: ${Object.keys(bookings).length} zile`);
    } catch (error) {
        console.log(`📊 Fișier de rezervări nou va fi creat`);
    }
});

// Gestionarea semnalelor pentru oprirea gracioasă
process.on('SIGINT', () => {
    console.log('\n📴 Serverul se oprește...');
    // Curăță token-urile active
    activeTokens.clear();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n📴 Serverul se oprește...');
    // Curăță token-urile active
    activeTokens.clear();
    process.exit(0);
});

// Curăță token-urile expirate la fiecare oră
setInterval(() => {
    const now = Date.now();
    const expiredTokens = [];

    for (const [token, data] of activeTokens.entries()) {
        if (now - data.createdAt > 24 * 60 * 60 * 1000) {
            expiredTokens.push(token);
        }
    }

    expiredTokens.forEach(token => activeTokens.delete(token));

    if (expiredTokens.length > 0) {
        console.log(`🧹 Curățat ${expiredTokens.length} token-uri expirate`);
    }
}, 60 * 60 * 1000); // la fiecare oră