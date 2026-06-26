import React, { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";

type Client = {
  id: string;
  firstName: string;
  lastName: string;
  phone?: string | null;
};

type Appointment = {
  id: string;
  startTime: string;
  endTime: string;
  serviceName: string;
  status: string;
  notes?: string | null;
  client: Client;
  reminderSent?: boolean;
};

type Service = {
  id: string;
  name: string;
  duration: number;
  price: number;
};

type Barber = {
  id: string;
  firstName: string;
  lastName: string;
  name: string;
};

const BarbershopApp: React.FC = () => {
  const { user, logout } = useAuth();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [activeTab, setActiveTab] = useState<"schedule" | "book" | "notifications" | "time">("schedule");
  const [sendingReminder, setSendingReminder] = useState<string | null>(null);
  const [reminderMessage, setReminderMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Booking form state
  const [services, setServices] = useState<Service[]>([]);
  const [barbers, setBarbers] = useState<Barber[]>([]);
  const [bookingForm, setBookingForm] = useState({
    clientFirstName: "",
    clientLastName: "",
    clientPhone: "",
    clientEmail: "",
    serviceId: "",
    barberId: "",
    date: new Date().toISOString().slice(0, 10),
    startTime: "09:00",
    notes: "",
  });
  const [bookingLoading, setBookingLoading] = useState(false);
  const [bookingSuccess, setBookingSuccess] = useState<string | null>(null);
  const [bookingError, setBookingError] = useState<string | null>(null);

  const fetchSchedule = async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (date) {
      params.append("dateFrom", date);
      params.append("dateTo", date);
    }
    const res = await fetch(`/api/barber/schedule?${params.toString()}`, { credentials: "include" });
    setLoading(false);
    if (res.ok) {
      setAppointments(await res.json());
    }
  };

  const fetchServicesAndBarbers = async () => {
    try {
      const [servicesRes, barbersRes] = await Promise.all([
        fetch("/api/barbershop/services", { credentials: "include" }),
        fetch("/api/barbershop/barbers", { credentials: "include" }),
      ]);
      if (servicesRes.ok) setServices(await servicesRes.json());
      if (barbersRes.ok) setBarbers(await barbersRes.json());
    } catch (err) {
      console.error("Error loading booking data:", err);
    }
  };

  useEffect(() => {
    fetchSchedule();
  }, [date]);

  useEffect(() => {
    if (activeTab === "book") {
      fetchServicesAndBarbers();
    }
  }, [activeTab]);

  const handleStatusChange = async (id: string, status: string) => {
    const res = await fetch(`/api/barber/appointments/${id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ status }),
    });
    if (res.ok) fetchSchedule();
  };

  const handleLogout = () => {
    logout();
    window.location.href = "/login";
  };

  const handleBookingSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBookingError(null);
    setBookingSuccess(null);
    setBookingLoading(true);

    try {
      const res = await fetch("/api/barbershop/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(bookingForm),
      });

      const data = await res.json();

      if (res.ok) {
        setBookingSuccess(`Appointment booked for ${data.clientName} on ${data.date} at ${data.startTime}`);
        setBookingForm({
          clientFirstName: "",
          clientLastName: "",
          clientPhone: "",
          clientEmail: "",
          serviceId: "",
          barberId: "",
          date: new Date().toISOString().slice(0, 10),
          startTime: "09:00",
          notes: "",
        });
        // Refresh schedule if viewing same date
        if (bookingForm.date === date) {
          fetchSchedule();
        }
      } else {
        setBookingError(data.error || "Failed to book appointment");
      }
    } catch (err) {
      setBookingError("Network error. Please try again.");
    }
    setBookingLoading(false);
  };

  const selectedService = services.find(s => s.id === bookingForm.serviceId);

  const sendReminder = async (appointmentId: string, clientPhone: string | null | undefined) => {
    if (!clientPhone) {
      setReminderMessage({ type: "error", text: "No phone number on file for this client" });
      return;
    }
    setSendingReminder(appointmentId);
    setReminderMessage(null);
    try {
      const res = await fetch(`/api/barbershop/appointments/${appointmentId}/send-reminder`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (res.ok) {
        setReminderMessage({ type: "success", text: "Reminder sent successfully!" });
        setAppointments(prev => prev.map(a => 
          a.id === appointmentId ? { ...a, reminderSent: true } : a
        ));
      } else {
        setReminderMessage({ type: "error", text: data.error || "Failed to send reminder" });
      }
    } catch (err) {
      setReminderMessage({ type: "error", text: "Network error sending reminder" });
    }
    setSendingReminder(null);
  };

  return (
    <div className="standalone-app barbershop-app" data-testid="barbershop-app">
      <header className="app-header barbershop-header">
        <div className="app-header-brand">
          <h1>IFCDC Barbershop</h1>
        </div>
        <nav className="app-header-nav">
          <button 
            className={activeTab === "schedule" ? "active" : ""} 
            onClick={() => setActiveTab("schedule")}
            data-testid="tab-schedule"
          >
            Schedule
          </button>
          <button 
            className={activeTab === "book" ? "active" : ""} 
            onClick={() => setActiveTab("book")}
            data-testid="tab-book"
          >
            Book Client
          </button>
          <button 
            className={activeTab === "notifications" ? "active" : ""} 
            onClick={() => setActiveTab("notifications")}
            data-testid="tab-notifications"
          >
            SMS
          </button>
          <button 
            className={activeTab === "time" ? "active" : ""} 
            onClick={() => setActiveTab("time")}
            data-testid="tab-time"
          >
            My Hours
          </button>
        </nav>
        <div className="app-header-user">
          <span>{user?.name || user?.email}</span>
          <button onClick={handleLogout} data-testid="btn-logout">Logout</button>
        </div>
      </header>

      <main className="app-main">
        {activeTab === "schedule" && (
          <section className="app-section" data-testid="section-schedule">
            {reminderMessage && (
              <div className={`reminder-message ${reminderMessage.type}`} data-testid="reminder-message">
                {reminderMessage.text}
                <button onClick={() => setReminderMessage(null)} className="dismiss-btn">×</button>
              </div>
            )}
            <div className="section-header">
              <h2>Today's Schedule</h2>
              <div className="date-picker">
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  data-testid="input-date"
                />
                <button onClick={fetchSchedule} data-testid="btn-refresh">Refresh</button>
              </div>
            </div>

            {loading ? (
              <div className="loading">Loading appointments...</div>
            ) : appointments.length === 0 ? (
              <div className="empty-state">
                <p>No appointments scheduled for this day.</p>
              </div>
            ) : (
              <div className="appointments-list">
                {appointments.map((a) => (
                  <div key={a.id} className={`appointment-card status-${a.status}`} data-testid={`appointment-${a.id}`}>
                    <div className="appointment-time">
                      {new Date(a.startTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      {" - "}
                      {new Date(a.endTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </div>
                    <div className="appointment-details">
                      <div className="client-name">{a.client.firstName} {a.client.lastName}</div>
                      {a.client.phone && <div className="client-phone">{a.client.phone}</div>}
                      <div className="service-name">{a.serviceName}</div>
                    </div>
                    <div className="appointment-status">
                      <span className={`status-badge ${a.status}`}>{a.status}</span>
                    </div>
                    {a.status === "scheduled" && (
                      <div className="appointment-actions">
                        <button onClick={() => handleStatusChange(a.id, "completed")} className="btn-complete">Complete</button>
                        <button onClick={() => handleStatusChange(a.id, "no_show")} className="btn-noshow">No-Show</button>
                        <button onClick={() => handleStatusChange(a.id, "cancelled")} className="btn-cancel">Cancel</button>
                        {a.client.phone && (
                          <button 
                            onClick={() => sendReminder(a.id, a.client.phone)} 
                            className="btn-reminder"
                            disabled={sendingReminder === a.id || a.reminderSent}
                            data-testid={`btn-reminder-${a.id}`}
                          >
                            {sendingReminder === a.id ? "Sending..." : a.reminderSent ? "Sent" : "Send Reminder"}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {activeTab === "book" && (
          <section className="app-section" data-testid="section-book">
            <h2>Book a Client</h2>
            
            {bookingSuccess && (
              <div className="booking-success" data-testid="booking-success">
                {bookingSuccess}
              </div>
            )}
            
            {bookingError && (
              <div className="booking-error" data-testid="booking-error">
                {bookingError}
              </div>
            )}

            <form onSubmit={handleBookingSubmit} className="booking-form">
              <div className="form-section">
                <h3>Client Information</h3>
                <div className="form-row">
                  <div className="form-group">
                    <label>First Name *</label>
                    <input
                      type="text"
                      value={bookingForm.clientFirstName}
                      onChange={(e) => setBookingForm({ ...bookingForm, clientFirstName: e.target.value })}
                      required
                      data-testid="input-client-first-name"
                    />
                  </div>
                  <div className="form-group">
                    <label>Last Name *</label>
                    <input
                      type="text"
                      value={bookingForm.clientLastName}
                      onChange={(e) => setBookingForm({ ...bookingForm, clientLastName: e.target.value })}
                      required
                      data-testid="input-client-last-name"
                    />
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label>Phone</label>
                    <input
                      type="tel"
                      value={bookingForm.clientPhone}
                      onChange={(e) => setBookingForm({ ...bookingForm, clientPhone: e.target.value })}
                      placeholder="(555) 555-5555"
                      data-testid="input-client-phone"
                    />
                  </div>
                  <div className="form-group">
                    <label>Email</label>
                    <input
                      type="email"
                      value={bookingForm.clientEmail}
                      onChange={(e) => setBookingForm({ ...bookingForm, clientEmail: e.target.value })}
                      placeholder="client@email.com"
                      data-testid="input-client-email"
                    />
                  </div>
                </div>
              </div>

              <div className="form-section">
                <h3>Service & Barber</h3>
                <div className="form-row">
                  <div className="form-group">
                    <label>Service *</label>
                    <select
                      value={bookingForm.serviceId}
                      onChange={(e) => setBookingForm({ ...bookingForm, serviceId: e.target.value })}
                      required
                      data-testid="select-service"
                    >
                      <option value="">Select a service...</option>
                      {services.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} - ${s.price} ({s.duration} min)
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Barber *</label>
                    <select
                      value={bookingForm.barberId}
                      onChange={(e) => setBookingForm({ ...bookingForm, barberId: e.target.value })}
                      required
                      data-testid="select-barber"
                    >
                      <option value="">Select a barber...</option>
                      {barbers.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div className="form-section">
                <h3>Date & Time</h3>
                <div className="form-row">
                  <div className="form-group">
                    <label>Date *</label>
                    <input
                      type="date"
                      value={bookingForm.date}
                      onChange={(e) => setBookingForm({ ...bookingForm, date: e.target.value })}
                      min={new Date().toISOString().slice(0, 10)}
                      required
                      data-testid="input-booking-date"
                    />
                  </div>
                  <div className="form-group">
                    <label>Start Time *</label>
                    <select
                      value={bookingForm.startTime}
                      onChange={(e) => setBookingForm({ ...bookingForm, startTime: e.target.value })}
                      required
                      data-testid="select-start-time"
                    >
                      {Array.from({ length: 20 }, (_, i) => {
                        const hour = Math.floor(i / 2) + 9;
                        const minute = (i % 2) * 30;
                        const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
                        const displayTime = new Date(`2000-01-01T${time}`).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
                        return (
                          <option key={time} value={time}>
                            {displayTime}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                </div>
                {selectedService && (
                  <div className="form-info">
                    Appointment will end at approximately {(() => {
                      const [h, m] = bookingForm.startTime.split(':').map(Number);
                      const endDate = new Date(2000, 0, 1, h, m + selectedService.duration);
                      return endDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
                    })()}
                  </div>
                )}
              </div>

              <div className="form-section">
                <h3>Notes</h3>
                <div className="form-group">
                  <textarea
                    value={bookingForm.notes}
                    onChange={(e) => setBookingForm({ ...bookingForm, notes: e.target.value })}
                    placeholder="Any special requests or notes..."
                    rows={3}
                    data-testid="input-notes"
                  />
                </div>
              </div>

              <div className="form-actions">
                <button 
                  type="submit" 
                  disabled={bookingLoading}
                  className="btn-book"
                  data-testid="btn-submit-booking"
                >
                  {bookingLoading ? "Booking..." : "Book Appointment"}
                </button>
              </div>
            </form>
          </section>
        )}

        {activeTab === "notifications" && (
          <section className="app-section" data-testid="section-notifications">
            <h2>SMS Notifications</h2>
            <div className="notifications-info">
              <p>Send appointment reminders to clients via SMS.</p>
              <div className="notification-status">
                <span className="status-label">SMS Status:</span>
                <span className="status-value">
                  {/* This will show the current Twilio configuration status */}
                  Ready (Twilio)
                </span>
              </div>
            </div>

            <div className="upcoming-reminders">
              <h3>Upcoming Appointments</h3>
              <p className="help-text">Click "Send Reminder" on the Schedule tab to notify clients about their appointments.</p>
              
              {appointments.filter(a => a.status === "scheduled").length === 0 ? (
                <div className="empty-state">
                  <p>No upcoming appointments for {date}. Change the date on the Schedule tab to view other days.</p>
                </div>
              ) : (
                <div className="reminder-list">
                  {appointments.filter(a => a.status === "scheduled").map((a) => (
                    <div key={a.id} className="reminder-item" data-testid={`reminder-item-${a.id}`}>
                      <div className="reminder-client">
                        <strong>{a.client.firstName} {a.client.lastName}</strong>
                        <span className="reminder-phone">{a.client.phone || "No phone"}</span>
                      </div>
                      <div className="reminder-time">
                        {new Date(a.startTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                        <span className="reminder-service">{a.serviceName}</span>
                      </div>
                      <div className="reminder-actions">
                        {a.client.phone ? (
                          <button 
                            onClick={() => sendReminder(a.id, a.client.phone)} 
                            className={`btn-send-reminder ${a.reminderSent ? 'sent' : ''}`}
                            disabled={sendingReminder === a.id || a.reminderSent}
                            data-testid={`btn-send-reminder-${a.id}`}
                          >
                            {sendingReminder === a.id ? "Sending..." : a.reminderSent ? "Sent" : "Send SMS"}
                          </button>
                        ) : (
                          <span className="no-phone-warning">No phone number</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        {activeTab === "time" && (
          <section className="app-section" data-testid="section-time">
            <h2>Log My Hours</h2>
            <p>Time tracking for your work hours.</p>
            <a href="/my-time" className="btn-link">Open Time Tracker</a>
          </section>
        )}
      </main>

      <footer className="app-footer">
        <p>IFCDC Barbershop | Part of Imperial Foundation CDC</p>
      </footer>
    </div>
  );
};

export default BarbershopApp;
