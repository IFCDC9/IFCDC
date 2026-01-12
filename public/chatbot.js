(function() {
  const CHATBOT_STYLES = `
    .ifcdc-chatbot-btn {
      position: fixed;
      bottom: 20px;
      right: 20px;
      width: 60px;
      height: 60px;
      border-radius: 50%;
      background: linear-gradient(135deg, #d4af37 0%, #b8962e 100%);
      border: none;
      cursor: pointer;
      box-shadow: 0 4px 20px rgba(212, 175, 55, 0.4);
      z-index: 9999;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    .ifcdc-chatbot-btn:hover {
      transform: scale(1.1);
      box-shadow: 0 6px 25px rgba(212, 175, 55, 0.5);
    }
    .ifcdc-chatbot-btn svg {
      width: 28px;
      height: 28px;
      fill: #000;
    }
    .ifcdc-chatbot-window {
      position: fixed;
      bottom: 90px;
      right: 20px;
      width: 360px;
      max-width: calc(100vw - 40px);
      height: 480px;
      max-height: calc(100vh - 120px);
      background: #111;
      border: 1px solid #333;
      border-radius: 12px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.5);
      z-index: 9998;
      display: none;
      flex-direction: column;
      overflow: hidden;
    }
    .ifcdc-chatbot-window.open {
      display: flex;
    }
    .ifcdc-chatbot-header {
      background: linear-gradient(135deg, #1a1a1a 0%, #000 100%);
      padding: 16px;
      border-bottom: 2px solid #d4af37;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .ifcdc-chatbot-header h3 {
      margin: 0;
      color: #d4af37;
      font-size: 1rem;
      font-weight: 600;
    }
    .ifcdc-chatbot-close {
      background: none;
      border: none;
      color: #888;
      font-size: 1.5rem;
      cursor: pointer;
      padding: 0;
      line-height: 1;
    }
    .ifcdc-chatbot-close:hover {
      color: #fff;
    }
    .ifcdc-chatbot-messages {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .ifcdc-chatbot-message {
      max-width: 85%;
      padding: 10px 14px;
      border-radius: 12px;
      font-size: 0.9rem;
      line-height: 1.4;
    }
    .ifcdc-chatbot-message.bot {
      background: #222;
      color: #f5f5f5;
      align-self: flex-start;
      border-bottom-left-radius: 4px;
    }
    .ifcdc-chatbot-message.user {
      background: #d4af37;
      color: #000;
      align-self: flex-end;
      border-bottom-right-radius: 4px;
    }
    .ifcdc-chatbot-message.typing {
      background: #222;
      color: #888;
    }
    .ifcdc-chatbot-input-area {
      padding: 12px;
      border-top: 1px solid #333;
      display: flex;
      gap: 8px;
    }
    .ifcdc-chatbot-input {
      flex: 1;
      background: #1a1a1a;
      border: 1px solid #444;
      border-radius: 8px;
      padding: 10px 14px;
      color: #f5f5f5;
      font-size: 0.9rem;
      outline: none;
    }
    .ifcdc-chatbot-input:focus {
      border-color: #d4af37;
    }
    .ifcdc-chatbot-input::placeholder {
      color: #666;
    }
    .ifcdc-chatbot-send {
      background: #d4af37;
      border: none;
      border-radius: 8px;
      padding: 10px 16px;
      color: #000;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
    }
    .ifcdc-chatbot-send:hover {
      background: #e5c04a;
    }
    .ifcdc-chatbot-send:disabled {
      background: #555;
      color: #888;
      cursor: not-allowed;
    }
  `;

  function createChatbot() {
    const styleEl = document.createElement('style');
    styleEl.textContent = CHATBOT_STYLES;
    document.head.appendChild(styleEl);

    const btn = document.createElement('button');
    btn.className = 'ifcdc-chatbot-btn';
    btn.setAttribute('aria-label', 'Open chat');
    btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/></svg>';

    const chatWindow = document.createElement('div');
    chatWindow.className = 'ifcdc-chatbot-window';
    chatWindow.innerHTML = `
      <div class="ifcdc-chatbot-header">
        <h3>IFCDC Assistant</h3>
        <button class="ifcdc-chatbot-close" aria-label="Close chat">&times;</button>
      </div>
      <div class="ifcdc-chatbot-messages">
        <div class="ifcdc-chatbot-message bot">Hi! I'm the IFCDC assistant. Ask me about our programs, policies, or how to get in touch.</div>
      </div>
      <div class="ifcdc-chatbot-input-area">
        <input type="text" class="ifcdc-chatbot-input" placeholder="Type your question..." maxlength="500" />
        <button class="ifcdc-chatbot-send">Send</button>
      </div>
    `;

    document.body.appendChild(btn);
    document.body.appendChild(chatWindow);

    const closeBtn = chatWindow.querySelector('.ifcdc-chatbot-close');
    const messagesEl = chatWindow.querySelector('.ifcdc-chatbot-messages');
    const inputEl = chatWindow.querySelector('.ifcdc-chatbot-input');
    const sendBtn = chatWindow.querySelector('.ifcdc-chatbot-send');

    let conversationHistory = [];

    btn.addEventListener('click', function() {
      chatWindow.classList.toggle('open');
      if (chatWindow.classList.contains('open')) {
        inputEl.focus();
      }
    });

    closeBtn.addEventListener('click', function() {
      chatWindow.classList.remove('open');
    });

    function addMessage(content, isUser) {
      const msgEl = document.createElement('div');
      msgEl.className = 'ifcdc-chatbot-message ' + (isUser ? 'user' : 'bot');
      msgEl.textContent = content;
      messagesEl.appendChild(msgEl);
      messagesEl.scrollTop = messagesEl.scrollHeight;
      return msgEl;
    }

    function showTyping() {
      const typingEl = document.createElement('div');
      typingEl.className = 'ifcdc-chatbot-message bot typing';
      typingEl.textContent = 'Typing...';
      typingEl.id = 'typing-indicator';
      messagesEl.appendChild(typingEl);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function removeTyping() {
      const typingEl = document.getElementById('typing-indicator');
      if (typingEl) typingEl.remove();
    }

    async function sendMessage() {
      const message = inputEl.value.trim();
      if (!message) return;

      inputEl.value = '';
      sendBtn.disabled = true;
      inputEl.disabled = true;

      addMessage(message, true);
      conversationHistory.push({ role: 'user', content: message });

      showTyping();

      try {
        const response = await fetch('/api/public/chatbot', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, conversationHistory: conversationHistory.slice(-6) })
        });

        removeTyping();

        if (response.ok) {
          const data = await response.json();
          addMessage(data.response, false);
          conversationHistory.push({ role: 'assistant', content: data.response });
        } else {
          addMessage('Sorry, I encountered an error. Please try again or call us at (732) 743-5048.', false);
        }
      } catch (err) {
        removeTyping();
        addMessage('Connection error. Please check your internet and try again.', false);
      }

      sendBtn.disabled = false;
      inputEl.disabled = false;
      inputEl.focus();
    }

    sendBtn.addEventListener('click', sendMessage);
    inputEl.addEventListener('keypress', function(e) {
      if (e.key === 'Enter') sendMessage();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createChatbot);
  } else {
    createChatbot();
  }
})();
