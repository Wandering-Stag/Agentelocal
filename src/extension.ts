import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {

	console.log('¡Felicidades, tu extensión "agente-limpio" está ahora activa!');

	// --- Comando para abrir el panel de chat (sin contexto) ---
	const openPanelCommand = vscode.commands.registerCommand('agente-limpio.openPanel', () => {
		const panel = vscode.window.createWebviewPanel('agentPanel', 'Panel del Agente', vscode.ViewColumn.One, { enableScripts: true });
		panel.webview.html = getWebviewContent();
		panel.webview.onDidReceiveMessage(
			async message => {
				if (message.command === 'askAgent') {
					vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "El Agente está pensando..." }, async () => {
						const agentResponse = await callOllama(message.text);
						vscode.window.showInformationMessage(`Respuesta del Agente: ${agentResponse}`, { modal: true });
					});
				}
			}
		);
	});

	// --- Comando para EXPLICAR código (solo lectura) ---
	const explainCodeCommand = vscode.commands.registerCommand('agente-limpio.explainCode', () => {
		const editor = vscode.window.activeTextEditor;
		if (editor) {
			const selection = editor.document.getText(editor.selection);
			if (selection) {
				const fullPrompt = `Por favor, explica el siguiente fragmento de código de forma clara y concisa:\n\`\`\`\n${selection}\n\`\`\``;
				vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "El Agente está analizando el código..." }, async () => {
					const agentResponse = await callOllama(fullPrompt);
					vscode.window.showInformationMessage(`Explicación del Agente: ${agentResponse}`, { modal: true });
				});
			}
		}
	});

	// --- ¡NUEVO COMANDO! Para MODIFICAR código (escritura) ---
	const modifyCodeCommand = vscode.commands.registerCommand('agente-limpio.modifyCode', async () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			vscode.window.showErrorMessage("No hay un editor de texto activo.");
			return;
		}

		const selection = editor.selection;
		const selectedText = editor.document.getText(selection);

		if (!selectedText) {
			vscode.window.showWarningMessage("Por favor, selecciona el código que quieres modificar.");
			return;
		}

		// Pedimos al usuario que describa la modificación
		const modificationRequest = await vscode.window.showInputBox({
			prompt: "¿Qué modificación quieres hacer en el código seleccionado?",
			placeHolder: "Ej: refactoriza este código para que sea más eficiente, añade comentarios, etc."
		});

		if (!modificationRequest) {
			return; // El usuario canceló
		}

		const fullPrompt = `
			Tarea: El usuario quiere modificar un fragmento de código.
			Petición del usuario: "${modificationRequest}"
			Código original:
			\`\`\`
			${selectedText}
			\`\`\`
			Por favor, proporciona únicamente el código modificado, sin explicaciones adicionales ni la etiqueta de bloque de código (\`\`\`).
		`;

		vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "El Agente está modificando el código..." }, async () => {
			const agentResponse = await callOllama(fullPrompt);
			
			// Usamos editor.edit para reemplazar la selección con la respuesta del agente
			editor.edit(editBuilder => {
				editBuilder.replace(selection, agentResponse);
			});

			vscode.window.showInformationMessage("¡El código ha sido modificado!");
		});
	});

	context.subscriptions.push(openPanelCommand, explainCodeCommand, modifyCodeCommand);
}

async function callOllama(prompt: string): Promise<string> {
	try {
        const { default: fetch } = await import('node-fetch');
		const response = await fetch('http://localhost:11434/api/generate', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ model: 'codegemma', prompt: prompt, stream: false })
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
	return `<!DOCTYPE html>
	<html lang="en">
	<head>
		<meta charset="UTF-8">
		<meta name="viewport" content="width=device-width, initial-scale=1.0">
		<title>Panel del Agente</title>
		<style>
			body, html { height: 100%; margin: 0; padding: 10px; display: flex; flex-direction: column; font-family: var(--vscode-font-family); color: var(--vscode-editor-foreground); background-color: var(--vscode-editor-background); }
			textarea { flex-grow: 1; width: 98%; border: 1px solid var(--vscode-input-border); background-color: var(--vscode-input-background); color: var(--vscode-input-foreground); font-family: var(--vscode-font-family); font-size: 1.1em; padding: 5px; }
			button { margin-top: 10px; border: none; padding: 10px 15px; background-color: var(--vscode-button-background); color: var(--vscode-button-foreground); cursor: pointer; width: 100%; font-size: 1.1em; }
			button:hover { background-color: var(--vscode-button-hoverBackground); }
		</style>
	</head>
	<body>
		<textarea id="prompt-input" placeholder="Este panel es para preguntas generales sin contexto de código..."></textarea>
		<button id="ask-button">Preguntar al Agente</button>
		<script>
			const vscode = acquireVsCodeApi();
			const askButton = document.getElementById('ask-button');
			const promptInput = document.getElementById('prompt-input');
			askButton.addEventListener('click', () => {
				if (promptInput.value) { vscode.postMessage({ command: 'askAgent', text: promptInput.value }); }
			});
		</script>
	</body>
	</html>`;
}

export function deactivate() {}