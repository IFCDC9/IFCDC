import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { getBookings } from '../api/barbershopApi';

export default function BarbershopPage() {
  const { user } = useAuth();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [datetime, setDatetime] = useState('');
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (user) {
      loadBookings();
    }
  }, [user]);

  async function loadBookings() {
    try {
      const data = await getBookings();
      setBookings(data);
    } catch (err) {
      console.error('Failed to load bookings:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);

    const res = await fetch("/api/bookings", {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify({ name, phone, datetime }),
    });

    if (res.ok) {
      alert("Booking received! We'll confirm shortly.");
      setName('');
      setPhone('');
      setDatetime('');
      loadBookings();
    } else {
      alert("There was an issue saving your booking.");
    }
    setSubmitting(false);
  }

  return (
    <div className="barbershop-page">
      <header className="page-header">
        <div>
          <h1>Barbershop Booking</h1>
          <p>Schedule your appointment at the IFCDC Barbershop</p>
        </div>
      </header>

      <div className="barbershop-content">
        <div className="booking-form-card">
          <h2>Book an Appointment</h2>

          <form onSubmit={handleSubmit} className="booking-form">
            <div className="form-field">
              <label>Your Name</label>
              <input
                type="text"
                placeholder="Enter your name"
                value={name}
                onChange={e => setName(e.target.value)}
                required
                data-testid="input-name"
              />
            </div>

            <div className="form-field">
              <label>Phone Number</label>
              <input
                type="tel"
                placeholder="Enter your phone number"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                required
                data-testid="input-phone"
              />
            </div>

            <div className="form-field">
              <label>Preferred Date & Time</label>
              <input
                type="datetime-local"
                value={datetime}
                onChange={e => setDatetime(e.target.value)}
                required
                data-testid="input-datetime"
              />
            </div>

            <button 
              type="submit" 
              className="btn-primary"
              disabled={submitting}
              data-testid="button-book"
            >
              {submitting ? 'Booking...' : 'Book Appointment'}
            </button>
          </form>
        </div>

        <div className="bookings-list-card">
          <h2>Upcoming Appointments</h2>
          {loading ? (
            <div className="loading">Loading appointments...</div>
          ) : bookings.length === 0 ? (
            <div className="empty-state">No appointments scheduled yet.</div>
          ) : (
            <ul className="bookings-list">
              {bookings.map(booking => (
                <li key={booking.id} className="booking-item" data-testid={`booking-${booking.id}`}>
                  <div className="booking-info">
                    <div className="booking-name">{booking.name}</div>
                    <div className="booking-details">
                      <span>{booking.phone}</span>
                      <span>{new Date(booking.datetime).toLocaleString()}</span>
                    </div>
                  </div>
                  <div className={`booking-status status-${booking.status}`}>
                    {booking.status}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
