import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {

	console.log('¡Felicidades, tu extensión "agente-limpio" está ahora activa!');

	let disposable = vscode.commands.registerCommand('agente-limpio.openPanel', () => {
		const panel = vscode.window.createWebviewPanel(
			'agentPanel',
			'Panel del Agente',
			vscode.ViewColumn.One,
			{
				// Habilitamos los scripts en nuestra webview
				enableScripts: true
			}
		);

		panel.webview.html = getWebviewContent();

		// Escuchamos los mensajes que nos envía la webview (el botón)
		panel.webview.onDidReceiveMessage(
			async message => {
				switch (message.command) {
					case 'askAgent':
						// Obtenemos la pregunta del usuario
						const userPrompt = message.text;

						// Mostramos un mensaje de carga
						vscode.window.withProgress({
							location: vscode.ProgressLocation.Notification,
							title: "El Agente está pensando...",
							cancellable: false
						}, async (progress) => {
							// Llamamos a nuestra función para conectar con Ollama
							const agentResponse = await callOllama(userPrompt);
							
							// Mostramos la respuesta en un panel de información grande
							vscode.window.showInformationMessage(
								`Respuesta del Agente: ${agentResponse}`,
								{ modal: true } // El modo modal permite ver respuestas largas
							);
						});
						return;
				}
			},
			undefined,
			context.subscriptions
		);
	});

	context.subscriptions.push(disposable);
}

// Esta es la función que se conecta con el cerebro de CodeGemma
async function callOllama(prompt: string): Promise<string> {
	try {
        const { default: fetch } = await import('node-fetch');

		console.log("Enviando a Ollama:", prompt);
		const response = await fetch('http://localhost:11434/api/generate', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				model: 'codegemma',
				prompt: prompt,
				stream: false // Recibimos la respuesta de una sola vez
			})
		});

		if (!response.ok) {
			const errorText = await response.text();
			return `Error del servidor de Ollama: ${response.status} - ${errorText}`;
		}

		const responseData = await response.json();
		
        // ¡CORRECCIÓN! Le decimos a TypeScript que esperamos un objeto con una propiedad 'response'.
        return (responseData as { response: string }).response;

	} catch (error: any) {
		console.error("Error al conectar con Ollama:", error);
		return `Error de conexión: No se pudo conectar con Ollama. ¿Está corriendo? Detalles: ${error.message}`;
	}
}

function getWebviewContent() {
	// Hemos añadido CSS para que se vea bien y un script para la comunicación
	return `<!DOCTYPE html>
	<html lang="en">
	<head>
		<meta charset="UTF-8">
		<meta name="viewport" content="width=device-width, initial-scale=1.0">
		<title>Panel del Agente</title>
		<style>
			body, html {
				height: 100%;
				margin: 0;
				padding: 10px;
				display: flex;
				flex-direction: column;
				font-family: var(--vscode-font-family);
				color: var(--vscode-editor-foreground);
				background-color: var(--vscode-editor-background);
			}
			textarea {
				flex-grow: 1;
				width: 98%;
				border: 1px solid var(--vscode-input-border);
				background-color: var(--vscode-input-background);
				color: var(--vscode-input-foreground);
				font-family: var(--vscode-font-family);
				font-size: 1.1em;
				padding: 5px;
			}
			button {
				margin-top: 10px;
				border: none;
				padding: 10px 15px;
				background-color: var(--vscode-button-background);
				color: var(--vscode-button-foreground);
				cursor: pointer;
				width: 100%;
				font-size: 1.1em;
			}
			button:hover {
				background-color: var(--vscode-button-hoverBackground);
			}
		</style>
	</head>
	<body>
		<textarea id="prompt-input" placeholder="Ej: Explica qué es una API REST..."></textarea>
		<button id="ask-button">Preguntar al Agente</button>

		<script>
			const vscode = acquireVsCodeApi();
			const askButton = document.getElementById('ask-button');
			const promptInput = document.getElementById('prompt-input');

			askButton.addEventListener('click', () => {
				const text = promptInput.value;
				if (text) {
					vscode.postMessage({
						command: 'askAgent',
						text: text
					});
				}
			});
		</script>
	</body>
	</html>`;
}

export function deactivate() {}