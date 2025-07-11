import * as vscode from 'vscode';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {

	console.log('¡Felicidades, tu extensión "agente-limpio" está ahora activa!');

	// --- Comando para abrir el CHAT ---
	const openChatCommand = vscode.commands.registerCommand('agente-limpio.openChat', () => {
		const panel = vscode.window.createWebviewPanel(
			'agentChat', // ID interno
			'Chat con Agente', // Título de la pestaña
			vscode.ViewColumn.One,
			{
				enableScripts: true,
				// ¡NUEVO! Mantenemos el contenido del panel vivo incluso cuando no está visible
				retainContextWhenHidden: true 
			}
		);

		panel.webview.html = getWebviewContent();

		// Lógica para la comunicación bidireccional con el chat
		panel.webview.onDidReceiveMessage(
			async message => {
				if (message.command === 'askAgent') {
					const userPrompt = message.text;
					
					// ¡NUEVO! Enviamos una señal de "escribiendo..." al chat
					panel.webview.postMessage({ command: 'agentThinking' });

					const agentResponse = await callOllama(userPrompt, 'codegemma');

					// ¡NUEVO! Enviamos la respuesta final al chat para que la muestre
					panel.webview.postMessage({ command: 'agentResponse', text: agentResponse });
				}
			}
		);
	});

	// --- Comando para CREAR código desde cero ---
	const createCodeCommand = vscode.commands.registerCommand('agente-limpio.createCode', async () => { /* ...código existente... */ });
	const explainCodeCommand = vscode.commands.registerCommand('agente-limpio.explainCode', () => { /* ...código existente... */ });
	const modifyCodeCommand = vscode.commands.registerCommand('agente-limpio.modifyCode', async () => { /* ...código existente... */ });
	const proposeAndRefactorCommand = vscode.commands.registerCommand('agente-limpio.proposeAndRefactor', async () => { /* ...código existente... */ });

	context.subscriptions.push(openChatCommand, createCodeCommand, explainCodeCommand, modifyCodeCommand, proposeAndRefactorCommand);
}

async function callOllama(prompt: string, model: string): Promise<string> {
	try {
        const { default: fetch } = await import('node-fetch');
		const response = await fetch('http://localhost:11434/api/generate', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ model: model, prompt: prompt, stream: false })
		});
		if (!response.ok) {
			const errorText = await response.text();
			return `Error del servidor de Ollama: ${response.status} - ${errorText}`;
		}
		const responseData = await response.json();
        return (responseData as { response: string }).response;
	} catch (error: any) {
		return `Error de conexión: No se pudo conectar con Ollama. ¿Está corriendo? Detalles: ${error.message}`;
	}
}

function getWebviewContent() {
	// ¡NUEVO! HTML, CSS y JS para una interfaz de chat completa.
	return `<!DOCTYPE html>
	<html lang="en">
	<head>
		<meta charset="UTF-8">
		<meta name="viewport" content="width=device-width, initial-scale=1.0">
		<title>Chat con Agente</title>
		<style>
			body, html {
				height: 100%;
				margin: 0;
				padding: 0;
				overflow: hidden;
				font-family: var(--vscode-font-family);
				color: var(--vscode-editor-foreground);
				background-color: var(--vscode-editor-background);
			}
			#chat-container {
				display: flex;
				flex-direction: column;
				height: 100%;
			}
			#chat-log {
				flex-grow: 1;
				overflow-y: auto;
				padding: 10px;
			}
			.message {
				margin-bottom: 10px;
				padding: 8px 12px;
				border-radius: 18px;
				max-width: 80%;
				line-height: 1.4;
			}
			.user-message {
				background-color: var(--vscode-button-background);
				align-self: flex-end;
				margin-left: auto;
			}
			.agent-message {
				background-color: var(--vscode-input-background);
				align-self: flex-start;
				white-space: pre-wrap; /* Muestra saltos de línea y formato de código */
			}
			.typing-indicator {
				font-style: italic;
				color: var(--vscode-descriptionForeground);
			}
			#input-area {
				display: flex;
				padding: 10px;
				border-top: 1px solid var(--vscode-side-bar-border);
			}
			#prompt-input {
				flex-grow: 1;
				border: 1px solid var(--vscode-input-border);
				background-color: var(--vscode-input-background);
				color: var(--vscode-input-foreground);
				border-radius: 5px;
				padding: 8px;
			}
			#send-button {
				margin-left: 10px;
				border: none;
				background-color: var(--vscode-button-background);
				color: var(--vscode-button-foreground);
				cursor: pointer;
				padding: 8px 15px;
				border-radius: 5px;
			}
			#send-button:hover {
				background-color: var(--vscode-button-hoverBackground);
			}
		</style>
	</head>
	<body>
		<div id="chat-container">
			<div id="chat-log"></div>
			<div id="input-area">
				<input type="text" id="prompt-input" placeholder="Escribe tu mensaje..."/>
				<button id="send-button">Enviar</button>
			</div>
		</div>

		<script>
			const vscode = acquireVsCodeApi();
			const chatLog = document.getElementById('chat-log');
			const promptInput = document.getElementById('prompt-input');
			const sendButton = document.getElementById('send-button');

			// Función para añadir mensajes al log del chat
			function addMessage(text, sender) {
				const messageDiv = document.createElement('div');
				messageDiv.className = 'message ' + sender + '-message';
				messageDiv.textContent = text;
				chatLog.appendChild(messageDiv);
				chatLog.scrollTop = chatLog.scrollHeight; // Auto-scroll hacia abajo
			}

			// Función para manejar el envío de mensajes
			function sendMessage() {
				const text = promptInput.value;
				if (text) {
					addMessage(text, 'user');
					vscode.postMessage({ command: 'askAgent', text: text });
					promptInput.value = '';
				}
			}

			// Event listeners para el botón y la tecla Enter
			sendButton.addEventListener('click', sendMessage);
			promptInput.addEventListener('keyup', (event) => {
				if (event.key === 'Enter') {
					sendMessage();
				}
			});

			// Event listener para recibir mensajes DESDE la extensión
			window.addEventListener('message', event => {
				const message = event.data;
				switch (message.command) {
					case 'agentResponse':
						// Elimina el indicador de "escribiendo..."
						const indicator = document.querySelector('.typing-indicator');
						if (indicator) {
							indicator.remove();
						}
						addMessage(message.text, 'agent');
						break;
					case 'agentThinking':
						addMessage('El agente está escribiendo...', 'agent typing-indicator');
						break;
				}
			});
		</script>
	</body>
	</html>`;
}

export function deactivate() {}