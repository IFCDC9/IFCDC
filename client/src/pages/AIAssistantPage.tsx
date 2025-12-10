import React, { useState } from "react";
import Header from "../components/IFCDCHeader";

const AIAssistantPage = () => {
  const [message, setMessage] = useState("");
  const [conversation, setConversation] = useState<{ role: string; content: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"chat" | "radio" | "schedule">("chat");
  
  const [radioTopic, setRadioTopic] = useState("");
  const [radioType, setRadioType] = useState("announcement");
  const [radioContent, setRadioContent] = useState("");
  
  const [scheduleQuestion, setScheduleQuestion] = useState("");
  const [scheduleAnswer, setScheduleAnswer] = useState("");

  const sendMessage = async () => {
    if (!message.trim() || loading) return;
    
    const userMessage = message.trim();
    setConversation(prev => [...prev, { role: "user", content: userMessage }]);
    setMessage("");
    setLoading(true);
    
    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMessage }),
      });
      
      const data = await res.json();
      
      if (res.ok) {
        setConversation(prev => [...prev, { role: "assistant", content: data.response }]);
      } else {
        setConversation(prev => [...prev, { role: "assistant", content: data.error || "Something went wrong." }]);
      }
    } catch (err) {
      setConversation(prev => [...prev, { role: "assistant", content: "Network error. Please try again." }]);
    } finally {
      setLoading(false);
    }
  };

  const generateRadioContent = async () => {
    if (!radioTopic.trim() || loading) return;
    setLoading(true);
    setRadioContent("");
    
    try {
      const res = await fetch("/api/ai/radio-content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: radioTopic, contentType: radioType }),
      });
      
      const data = await res.json();
      setRadioContent(data.content || data.error || "Failed to generate content.");
    } catch (err) {
      setRadioContent("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const askScheduleQuestion = async () => {
    if (!scheduleQuestion.trim() || loading) return;
    setLoading(true);
    setScheduleAnswer("");
    
    try {
      const res = await fetch("/api/ai/schedule-help", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: scheduleQuestion }),
      });
      
      const data = await res.json();
      setScheduleAnswer(data.answer || data.error || "Failed to get answer.");
    } catch (err) {
      setScheduleAnswer("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Header />
      <main style={{ padding: "2rem", maxWidth: "900px", margin: "0 auto" }}>
        <h1 style={{ color: "#d4af37", marginBottom: "1rem" }}>AI Assistant</h1>
        <p style={{ color: "#ccc", marginBottom: "2rem" }}>
          Get help with client care, radio content, scheduling, and more.
        </p>

        <div style={{ display: "flex", gap: "1rem", marginBottom: "2rem", flexWrap: "wrap" }}>
          <button
            onClick={() => setActiveTab("chat")}
            className={`nav-button ${activeTab === "chat" ? "gold-3d" : ""}`}
            data-testid="tab-chat"
            style={{ opacity: activeTab === "chat" ? 1 : 0.6 }}
          >
            General Chat
          </button>
          <button
            onClick={() => setActiveTab("radio")}
            className={`nav-button ${activeTab === "radio" ? "gold-3d" : ""}`}
            data-testid="tab-radio"
            style={{ opacity: activeTab === "radio" ? 1 : 0.6 }}
          >
            Radio Content
          </button>
          <button
            onClick={() => setActiveTab("schedule")}
            className={`nav-button ${activeTab === "schedule" ? "gold-3d" : ""}`}
            data-testid="tab-schedule"
            style={{ opacity: activeTab === "schedule" ? 1 : 0.6 }}
          >
            Schedule Help
          </button>
        </div>

        {activeTab === "chat" && (
          <div data-testid="panel-chat">
            <div
              style={{
                background: "#111",
                border: "1px solid #333",
                borderRadius: "8px",
                padding: "1rem",
                height: "400px",
                overflowY: "auto",
                marginBottom: "1rem",
              }}
            >
              {conversation.length === 0 ? (
                <p style={{ color: "#666", textAlign: "center", marginTop: "150px" }}>
                  Start a conversation with the AI assistant...
                </p>
              ) : (
                conversation.map((msg, idx) => (
                  <div
                    key={idx}
                    style={{
                      marginBottom: "1rem",
                      textAlign: msg.role === "user" ? "right" : "left",
                    }}
                  >
                    <span
                      style={{
                        display: "inline-block",
                        padding: "0.75rem 1rem",
                        borderRadius: "12px",
                        maxWidth: "80%",
                        background: msg.role === "user" ? "#d4af37" : "#222",
                        color: msg.role === "user" ? "#000" : "#fff",
                      }}
                      data-testid={`message-${msg.role}-${idx}`}
                    >
                      {msg.content}
                    </span>
                  </div>
                ))
              )}
              {loading && (
                <div style={{ textAlign: "left" }}>
                  <span style={{ color: "#666" }}>Thinking...</span>
                </div>
              )}
            </div>
            
            <div style={{ display: "flex", gap: "1rem" }}>
              <input
                type="text"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyPress={(e) => e.key === "Enter" && sendMessage()}
                placeholder="Ask anything about IFCDC..."
                style={{
                  flex: 1,
                  padding: "0.75rem 1rem",
                  borderRadius: "8px",
                  border: "1px solid #333",
                  background: "#111",
                  color: "#fff",
                }}
                disabled={loading}
                data-testid="input-chat-message"
              />
              <button
                onClick={sendMessage}
                disabled={loading || !message.trim()}
                className="nav-button gold-3d"
                data-testid="button-send-message"
              >
                Send
              </button>
            </div>
          </div>
        )}

        {activeTab === "radio" && (
          <div data-testid="panel-radio">
            <div style={{ marginBottom: "1rem" }}>
              <label style={{ color: "#d4af37", display: "block", marginBottom: "0.5rem" }}>Topic</label>
              <input
                type="text"
                value={radioTopic}
                onChange={(e) => setRadioTopic(e.target.value)}
                placeholder="e.g., Mental health awareness month"
                style={{
                  width: "100%",
                  padding: "0.75rem 1rem",
                  borderRadius: "8px",
                  border: "1px solid #333",
                  background: "#111",
                  color: "#fff",
                }}
                data-testid="input-radio-topic"
              />
            </div>
            
            <div style={{ marginBottom: "1rem" }}>
              <label style={{ color: "#d4af37", display: "block", marginBottom: "0.5rem" }}>Content Type</label>
              <select
                value={radioType}
                onChange={(e) => setRadioType(e.target.value)}
                style={{
                  width: "100%",
                  padding: "0.75rem 1rem",
                  borderRadius: "8px",
                  border: "1px solid #333",
                  background: "#111",
                  color: "#fff",
                }}
                data-testid="select-radio-type"
              >
                <option value="announcement">30-Second Announcement</option>
                <option value="segment">2-Minute Segment Outline</option>
                <option value="talking_points">Discussion Talking Points</option>
              </select>
            </div>
            
            <button
              onClick={generateRadioContent}
              disabled={loading || !radioTopic.trim()}
              className="nav-button gold-3d"
              style={{ marginBottom: "1rem" }}
              data-testid="button-generate-radio"
            >
              {loading ? "Generating..." : "Generate Content"}
            </button>
            
            {radioContent && (
              <div
                style={{
                  background: "#111",
                  border: "1px solid #333",
                  borderRadius: "8px",
                  padding: "1.5rem",
                  whiteSpace: "pre-wrap",
                  color: "#fff",
                }}
                data-testid="text-radio-content"
              >
                {radioContent}
              </div>
            )}
          </div>
        )}

        {activeTab === "schedule" && (
          <div data-testid="panel-schedule">
            <div style={{ marginBottom: "1rem" }}>
              <label style={{ color: "#d4af37", display: "block", marginBottom: "0.5rem" }}>
                Scheduling Question
              </label>
              <textarea
                value={scheduleQuestion}
                onChange={(e) => setScheduleQuestion(e.target.value)}
                placeholder="e.g., What's the best time to schedule back-to-back haircuts?"
                rows={3}
                style={{
                  width: "100%",
                  padding: "0.75rem 1rem",
                  borderRadius: "8px",
                  border: "1px solid #333",
                  background: "#111",
                  color: "#fff",
                  resize: "vertical",
                }}
                data-testid="input-schedule-question"
              />
            </div>
            
            <button
              onClick={askScheduleQuestion}
              disabled={loading || !scheduleQuestion.trim()}
              className="nav-button gold-3d"
              style={{ marginBottom: "1rem" }}
              data-testid="button-ask-schedule"
            >
              {loading ? "Thinking..." : "Get Help"}
            </button>
            
            {scheduleAnswer && (
              <div
                style={{
                  background: "#111",
                  border: "1px solid #333",
                  borderRadius: "8px",
                  padding: "1.5rem",
                  whiteSpace: "pre-wrap",
                  color: "#fff",
                }}
                data-testid="text-schedule-answer"
              >
                {scheduleAnswer}
              </div>
            )}
          </div>
        )}
      </main>
    </>
  );
};

export default AIAssistantPage;
