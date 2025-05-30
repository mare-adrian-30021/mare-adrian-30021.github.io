const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Pentru servirea fișierelor statice

// Calea către fișierul de date
const DATA_FILE = path.join(__dirname, 'data', 'bookings.json');

// Asigură-te că directorul data există
async function ensureDataDirectory() {
    const dataDir = path.dirname(DATA_FILE);
    try {
        await fs.access(dataDir);
    } catch (error) {
        await fs.mkdir(dataDir, { recursive: true });
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
    await ensureDataDirectory();
    await fs.writeFile(DATA_FILE, JSON.stringify(bookings, null, 2));
}

// Validează datele de intrare
function validateBookingData(data) {
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

    // Validează că data nu este în trecut
    const selectedDate = new Date(date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (selectedDate < today) {
        return { valid: false, message: 'Nu se pot face rezervări pentru date trecute' };
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

// Rute API

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
            id: Date.now().toString(), // ID simplu bazat pe timestamp
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

        res.status(201).json({
            message: 'Rezervarea a fost confirmată cu succes',
            booking: newBooking
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
        res.json(bookings);
    } catch (error) {
        console.error('Eroare la încărcarea rezervărilor:', error);
        res.status(500).json({ message: 'Eroare internă a serverului' });
    }
});

// DELETE /api/bookings/:date/:id - Șterge o rezervare
app.delete('/api/bookings/:date/:id', async (req, res) => {
    try {
        const { date, id } = req.params;
        const bookings = await loadBookings();

        if (!bookings[date]) {
            return res.status(404).json({ message: 'Nu există rezervări pentru această dată' });
        }

        const bookingIndex = bookings[date].findIndex(booking => booking.id === id);
        if (bookingIndex === -1) {
            return res.status(404).json({ message: 'Rezervarea nu a fost găsită' });
        }

        // Șterge rezervarea
        const deletedBooking = bookings[date].splice(bookingIndex, 1)[0];

        // Dacă nu mai sunt rezervări pentru această dată, șterge cheia
        if (bookings[date].length === 0) {
            delete bookings[date];
        }

        await saveBookings(bookings);

        res.json({
            message: 'Rezervarea a fost ștearsă cu succes',
            booking: deletedBooking
        });

    } catch (error) {
        console.error('Eroare la ștergerea rezervării:', error);
        res.status(500).json({ message: 'Eroare internă a serverului' });
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

// Middleware pentru gestionarea erorilor
app.use((err, req, res, next) => {
    console.error('Eroare neașteptată:', err);
    res.status(500).json({ message: 'Eroare internă a serverului' });
});

// Middleware pentru rute inexistente
app.use((req, res) => {
    res.status(404).json({ message: 'Ruta nu a fost găsită' });
});

// Pornește serverul
app.listen(PORT, async () => {
    await ensureDataDirectory();
    console.log(`🚀 Serverul rulează pe portul ${PORT}`);
    console.log(`📋 API disponibil la: http://localhost:${PORT}/api`);
    console.log(`🌐 Frontend disponibil la: http://localhost:${PORT}`);
});

// Gestionarea semnalelor pentru oprirea gracioasă
process.on('SIGINT', () => {
    console.log('\n📴 Serverul se oprește...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n📴 Serverul se oprește...');
    process.exit(0);
});