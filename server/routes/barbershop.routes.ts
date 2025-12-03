import { Router } from 'express';
import prisma from '../db/client';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.get('/', requireAuth, async (req, res) => {
  try {
    const bookings = await prisma.barbershopBooking.findMany({
      orderBy: { datetime: 'asc' },
    });
    res.json(bookings);
  } catch (error) {
    console.error('Error fetching bookings:', error);
    res.status(500).json({ error: 'Failed to fetch bookings' });
  }
});

router.post('/', requireAuth, async (req, res) => {
  try {
    const { name, phone, datetime } = req.body;

    if (!name || !phone || !datetime) {
      return res.status(400).json({ error: 'Name, phone, and datetime are required' });
    }

    const booking = await prisma.barbershopBooking.create({
      data: {
        name,
        phone,
        datetime: new Date(datetime),
      },
    });

    res.status(201).json(booking);
  } catch (error) {
    console.error('Error creating booking:', error);
    res.status(500).json({ error: 'Failed to create booking' });
  }
});

router.patch('/:id/status', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const booking = await prisma.barbershopBooking.update({
      where: { id: parseInt(id) },
      data: { status },
    });

    res.json(booking);
  } catch (error) {
    console.error('Error updating booking:', error);
    res.status(500).json({ error: 'Failed to update booking' });
  }
});

router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    await prisma.barbershopBooking.delete({
      where: { id: parseInt(id) },
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting booking:', error);
    res.status(500).json({ error: 'Failed to delete booking' });
  }
});

export default router;
