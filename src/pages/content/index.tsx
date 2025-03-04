// markdown-to-html

import { Marked } from "marked";
import { markedHighlight } from "marked-highlight";
import hljs from "highlight.js";
const COPY_ICON = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path fill-rule="evenodd" clip-rule="evenodd" d="M7 5C7 3.34315 8.34315 2 10 2H19C20.6569 2 22 3.34315 22 5V14C22 15.6569 20.6569 17 19 17H17V19C17 20.6569 15.6569 22 14 22H5C3.34315 22 2 20.6569 2 19V10C2 8.34315 3.34315 7 5 7H7V5ZM9 7H14C15.6569 7 17 8.34315 17 10V15H19C19.5523 15 20 14.5523 20 14V5C20 4.44772 19.5523 4 19 4H10C9.44772 4 9 4.44772 9 5V7ZM5 9C4.44772 9 4 9.44772 4 10V19C4 19.5523 4.44772 20 5 20H14C14.5523 20 15 19.5523 15 19V10C15 9.44772 14.5523 9 14 9H5Z" fill="currentColor"></path>
          </svg>`;
let isListening = false;
let authToken = "";
let onLatestConversationPage = false;
let lastMessage = "";

async function convertMarkdownToHTML(content: string, index: number) {
  // Configure marked options
  const marked = new Marked({
    ...markedHighlight({
      emptyLangClass: "hljs",
      langPrefix: "hljs language-",
      highlight(code: string, lang: string) {
        const language = hljs.getLanguage(lang) ? lang : "plaintext";
        return hljs.highlight(code, { language }).value; // Removed trim() to preserve whitespace
      },
    }),
  });

  marked.setOptions({
    gfm: true, // GitHub Flavored Markdown
    breaks: true, // Convert \n to <br>
  });

  // Custom renderer to override default HTML output
  const renderer = new marked.Renderer();

  // Customize code blocks
  renderer.code = ({ text, lang }) => {
    const html = `<pre class="!overflow-visible">
      <div class="contain-inline-size rounded-md border-[0.5px] border-token-border-medium relative bg-token-sidebar-surface-primary dark:bg-gray-950">
        <div class="flex absolute top-0 w-full items-center text-token-text-secondary px-4 py-2 text-xs font-sans justify-between rounded-t-md h-9 bg-token-sidebar-surface-primary dark:bg-token-main-surface-secondary select-none">
          <p>${lang || ""}</p>
          <button id="${index}-copy-button" class="flex gap-1 items-center select-none py-1">
          ${COPY_ICON}
          <span>Copy code</span>
          </button>
        </div>
        <div class="overflow-y-auto p-4 flex" dir="ltr">
          <code class="!whitespace-pre hljs language-${lang}" id="${index}-code">${text}</code>
        </div>
      </div>
    </pre>`;

    // Create a MutationObserver to watch for when the elements are added
    const observer = new MutationObserver((mutations, obs) => {
      const codeElement = document.getElementById(`${index}-code`);
      const copyButton = document.getElementById(`${index}-copy-button`);

      if (codeElement && copyButton) {
        copyButton.addEventListener("click", () => {
          console.log(`Copying code from element ${index}`);
          navigator.clipboard.writeText(codeElement.textContent || "");
          copyButton.innerHTML = COPY_ICON + "<span>Copied!</span>";
          setTimeout(() => {
            copyButton.innerHTML = COPY_ICON + "<span>Copy code</span>";
          }, 1000);
        });

        // Once we've found and set up our elements, disconnect the observer
        obs.disconnect();
      }
    });

    // Start observing the document with the configured parameters
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    return html;
  };

  // Customize inline code
  renderer.codespan = ({ text }) => {
    return `<code class="bg-token-surface-primary rounded px-1.5 py-0.5">${text}</code>`;
  };

  // Customize paragraphs
  renderer.paragraph = ({ text }) => {
    return `<p class="mb-4">${text}</p>`;
  };

  // Set the custom renderer
  marked.use({ renderer });

  // Convert markdown to HTML
  return marked.parse(content);
}

async function getSavedStorageSettings() {
  const settings = await chrome.storage.sync.get([
    "authToken",
    "onLatestConversationPage",
  ]);
  authToken = settings.authToken || "";
  onLatestConversationPage =
    Boolean(settings.onLatestConversationPage) || false;

  const latestConversation = await getRecentConversation();
  const currentConversationId = document.location.href.split("/c/")[1];
  if (latestConversation?.id === currentConversationId) {
    isListening = true;
    await latestConversationChecker();
    latestConversationCheckerInterval = setInterval(
      latestConversationChecker,
      2000
    );
  }
  console.log("Settings: ", settings);
}

async function init() {
  console.log("Initializing content");
  await getSavedStorageSettings();
  if (authToken === "") {
    await requestAuthToken();
  }

  addListeningButton();
}

async function getRecentConversation() {
  const res = await fetch(
    "https://chatgpt.com/backend-api/conversations?offset=0&limit=1&order=updated",
    {
      headers: { Authorization: `Bearer ${authToken}` },
    }
  );

  if (!res.ok) {
    console.error("Failed to get recent conversation ID");
    await requestAuthToken();
    alert("Failed to get recent conversation ID, auth token may be invalid");
    return;
  }

  const data = await res.json();

  const latestConversation = data.items[0];

  const createdTime = new Date(latestConversation.create_time);
  const now = new Date();
  const timeDifference = now.getTime() - createdTime.getTime();
  const minutesDifference = Math.floor(timeDifference / 60000);

  return {
    id: latestConversation.id,
    createdTime: createdTime,
    minutesDifference: minutesDifference,
  };
}

async function retrieveLastConversation() {
  const conversationId = location.href.split("/c/")[1];
  if (!conversationId) {
    console.log("No conversation ID found");
    return;
  }
  const res = await fetch(
    `https://chatgpt.com/backend-api/conversation/${conversationId}`,
    {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    }
  );
  if (!res.ok) {
    console.error("Failed to get latest conversations");
    alert("Failed to get latest conversations, auth token may be invalid");
    await requestAuthToken();
    return;
  }
  const data = await res.json();

  const filteredMapping = Object.entries(data.mapping).filter(
    ([key, value]: [string, any]) =>
      value?.message?.author?.role === "assistant"
  );

  const entries = Object.entries(filteredMapping);
  const lastEntry: [string, any] = entries[entries.length - 1];
  const entry = lastEntry[1][1];
  const message =
    entry.message.content?.parts[0]?.text || entry.message.content.parts[0];
  return message;
}

async function requestAuthToken() {
  authToken =
    prompt(
      "Enter your auth token from the cookie named `__Secure-next-auth.session-token.0` \n" +
        "Example: eyJhbGciOiJ... \n"
    ) || "";

  console.log("Auth token: ", authToken);
  await chrome.storage.sync.set({ authToken });
}

async function retryListeningButtonAdd(retryCount = 0, maxRetries = 10) {
  console.log(
    `Retrying container add (attempt ${retryCount + 1}/${maxRetries})`
  );
  if (retryCount >= maxRetries) {
    console.error("Max retries reached - could not find chat container");
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
  addListeningButton();
}

function updateListeningIcon(iconElement: HTMLElement) {
  console.log("Toggling listening: ", isListening);
  iconElement.innerHTML = isListening ? "🔊" : "🔇";
}

async function checkForNewlyCreatedConversations() {
  console.log("Checking for newly created conversations");
  const currentConversationId = document.location.href.split("/c/")[1];
  const latestConversation = await getRecentConversation();

  if (
    latestConversation &&
    latestConversation.id !== currentConversationId &&
    latestConversation.minutesDifference < 1
  ) {
    await chrome.storage.sync.set({ onLatestConversationPage: true });
    window.location.href = `/c/${latestConversation.id}`;
    return;
  }
}

let checkForNewlyCreatedConversationsInterval: NodeJS.Timeout;

function addListeningButton() {
  const sendButton = document.querySelector(
    "button[aria-label='Search the web']"
  ) as HTMLButtonElement;
  const sendButtonContainer = sendButton?.parentElement?.parentElement;
  if (!sendButton || !sendButtonContainer) {
    console.log("No send button found");
    void retryListeningButtonAdd();
    return;
  }

  const newButton = sendButton.cloneNode(true) as HTMLElement;
  newButton.style.opacity = "1";
  newButton.removeAttribute("disabled");
  newButton.style.fontSize = "large";
  newButton.innerHTML = "";
  const newButtonText = document.createElement("p");
  updateListeningIcon(newButtonText);
  newButton.appendChild(newButtonText);
  newButton.addEventListener("click", async () => {
    isListening = !isListening;
    const currentConversationId = document.location.href.split("/c/")[1];
    updateListeningIcon(newButtonText);

    if (!currentConversationId) {
      await chrome.storage.sync.set({ onLatestConversationPage: false });
      if (isListening) {
        await checkForNewlyCreatedConversations();
        checkForNewlyCreatedConversationsInterval = setInterval(
          checkForNewlyCreatedConversations,
          2000
        );
      } else {
        clearInterval(checkForNewlyCreatedConversationsInterval);
      }
      return;
    }

    if (!onLatestConversationPage) {
      const latestConversation = await getRecentConversation();
      if (!latestConversation) {
        return;
      }
      const latestConversationOnPage = document.location.href.includes(
        "/c/" + latestConversation.id
      );
      if (!latestConversationOnPage) {
        if (isListening) {
          await chrome.storage.sync.set({ onLatestConversationPage: false });
          await checkForNewlyCreatedConversations();
          checkForNewlyCreatedConversationsInterval = setInterval(
            checkForNewlyCreatedConversations,
            2000
          );
        } else {
          clearInterval(checkForNewlyCreatedConversationsInterval);
        }
        return;
      }
    }

    if (!onLatestConversationPage) {
      onLatestConversationPage = true;
      await chrome.storage.sync.set({ onLatestConversationPage: true });
    }

    await latestConversationChecker();

    if (isListening) {
      latestConversationCheckerInterval = setInterval(
        latestConversationChecker,
        2000
      );
    } else {
      clearInterval(latestConversationCheckerInterval);
    }
  });
  sendButtonContainer.parentElement?.appendChild(newButton);

  console.log("Listening button added");
}

let latestConversationCheckerInterval: NodeJS.Timeout;

function sanitizeMessage(message: string) {
  return message
    .replaceAll("`", "")
    .replace("ChatGPT said:", "")
    .replace("ChatGPT", "")
    .replaceAll("4o", "")
    .replaceAll("4o-mini", "")
    .replace("Copy code", "")
    .replace(/ /g, "")
    .replace(/[^a-zA-Z]/g, "");
}

async function latestConversationChecker() {
  console.log("Checking latest conversation");
  const articles = document.querySelectorAll("article h6");
  const lastArticle = articles[articles.length - 1];
  if (!lastArticle?.parentElement?.querySelector("p")) {
    console.warn("Could not find last message content");
    return;
  }
  lastMessage = lastArticle.parentElement.innerText || "";

  const newMessage = await retrieveLastConversation();
  if (!newMessage) {
    console.warn("Could not retrieve new message");
    return;
  }
  console.log("New message: ", newMessage);
  console.log("Last message: ", lastMessage);
  const sanitizedNewMessage = sanitizeMessage(newMessage);
  const sanitizedLastMessage = sanitizeMessage(lastMessage);

  console.log("Sanitized new message: ", sanitizedNewMessage);
  console.log("Sanitized last message: ", sanitizedLastMessage);

  console.log(
    "Sanitized new message === sanitized last message: ",
    sanitizedNewMessage === sanitizedLastMessage
  );
  if (sanitizedNewMessage === sanitizedLastMessage) {
    console.log("No new message");
    return;
  }
  lastMessage = newMessage;
  await addNewChatFromGPT(newMessage);
}

async function addNewChatFromGPT(newText: string) {
  console.log("Adding new chat from GPT");
  const chatContainer = document.querySelector("article h6")?.parentElement;
  const chatContent = chatContainer?.querySelector(".markdown p");
  const conversationContainer = chatContainer?.parentElement;

  if (!chatContainer || !chatContent || !conversationContainer) {
    console.log("No chat container found");
    return;
  }
  console.log("Chat container found");

  const clonedChatContainer = chatContainer.cloneNode(true) as HTMLElement;
  const clonedChatContent = clonedChatContainer.querySelector(".markdown p");
  if (!clonedChatContent) {
    console.log("No chat content found");
    return;
  }
  const html = await convertMarkdownToHTML(newText, 0);

  console.log("HTML: ", html);
  (clonedChatContent as HTMLElement).innerHTML = html;
  conversationContainer.appendChild(clonedChatContainer);
}

init();
