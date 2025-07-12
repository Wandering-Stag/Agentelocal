import * as vscode from 'vscode';
import * as path from 'path';
import { exec } from 'child_process';

// ¡NUEVA CONSTANTE! La dirección de nuestro cerebro en Python.
const AGENT_BACKEND_URL = 'http://127.0.0.1:5000/execute-task';

export function activate(context: vscode.ExtensionContext) {

	console.log('¡Felicidades, tu extensión "agente-limpio" está ahora activa!');

	// Creamos un canal de salida para mostrar los resultados de la terminal
	const outputChannel = vscode.window.createOutputChannel("Salida del Agente");

	// --- Comando para buscar en el proyecto ---
	const searchProjectCommand = vscode.commands.registerCommand('agente-limpio.searchProject', async () => {
		const query = await vscode.window.showInputBox({ prompt: "¿Qué quieres buscar en el proyecto?" });
		if (!query) { return; }

		vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Buscando "${query}"...` }, async () => {
			const findings = new Map<string, string>();
			for (const document of vscode.workspace.textDocuments) {
				if (document.uri.scheme === 'file') {
					const text = document.getText();
					if (text.toLowerCase().includes(query.toLowerCase())) {
						const relativePath = vscode.workspace.asRelativePath(document.uri.fsPath);
						findings.set(relativePath, `Encontrado en (archivo abierto): ${relativePath}\n`);
					}
				}
			}
			const files = await vscode.workspace.findFiles('**/*.*', '**/node_modules/**');
			for (const file of files) {
				const relativePath = vscode.workspace.asRelativePath(file.fsPath);
				if (findings.has(relativePath)) continue;
				try {
					const document = await vscode.workspace.openTextDocument(file);
					const text = document.getText();
					if (text.toLowerCase().includes(query.toLowerCase())) {
						findings.set(relativePath, `Encontrado en: ${relativePath}\n`);
					}
				} catch (e) { /* Ignorar errores */ }
			}
			outputChannel.clear();
			outputChannel.appendLine(`Resultados de la búsqueda para "${query}":\n`);
			if (findings.size > 0) {
				for (const find of findings.values()) { outputChannel.appendLine(find); }
			} else {
				outputChannel.appendLine('No se encontraron resultados.');
			}
			outputChannel.show();
		});
	});

	// --- Comando para ejecutar comandos de terminal ---
	const runTerminalCommand = vscode.commands.registerCommand('agente-limpio.runTerminal', async () => {
		const commandToRun = await vscode.window.showInputBox({ prompt: "Escribe el comando de terminal que quieres que el agente ejecute" });
		if (!commandToRun) { return; }

		const userConfirmation = await vscode.window.showWarningMessage(
			`¿Estás seguro de que quieres ejecutar el siguiente comando?\n\n> ${commandToRun}`,
			{ modal: true }, "Sí, ejecutar"
		);
		if (userConfirmation !== "Sí, ejecutar") { return; }

		vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Ejecutando: ${commandToRun}` }, async () => {
			const workspaceFolder = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath : undefined;
			exec(commandToRun, { cwd: workspaceFolder }, (error, stdout, stderr) => {
				outputChannel.clear();
				if (error) { outputChannel.appendLine(`ERROR:\n${error.message}`); outputChannel.show(); return; }
				if (stderr) { outputChannel.appendLine(`STDERR:\n${stderr}`); }
				outputChannel.appendLine(`STDOUT:\n${stdout}`);
				outputChannel.show();
			});
		});
	});

	// --- Comando para abrir el CHAT ---
	const openChatCommand = vscode.commands.registerCommand('agente-limpio.openChat', () => {
		const panel = vscode.window.createWebviewPanel('agentChat', 'Chat con Agente', vscode.ViewColumn.One, { enableScripts: true, retainContextWhenHidden: true });
		panel.webview.html = getWebviewContent();
		panel.webview.onDidReceiveMessage(
			async message => {
				if (message.command === 'askAgent') {
					panel.webview.postMessage({ command: 'agentThinking' });
					// ¡CAMBIO! Ahora llamamos a nuestro backend con el modelo que queremos usar.
					const agentResponse = await callAgentBackend(message.text, 'codegemma');
					panel.webview.postMessage({ command: 'agentResponse', text: agentResponse });
				}
			}
		);
	});

	// --- Comando para CREAR código desde cero ---
	const createCodeCommand = vscode.commands.registerCommand('agente-limpio.createCode', async () => {
		const description = await vscode.window.showInputBox({ prompt: "Describe el código que quieres crear." });
		if (!description) { return; }
		let finalCode = '';
		await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "El Agente está generando el código..." }, async () => {
			// ¡CAMBIO! Llamamos al backend. La lógica de doble cerebro ahora vive en Python.
			finalCode = await callAgentBackend(`Tarea: Crear un archivo de código. Descripción: "${description}"`, 'codegemma');
		});
		const saveUri = await vscode.window.showSaveDialog({ title: "Guardar el nuevo archivo" });
		if (!saveUri) { return; }
		await vscode.workspace.fs.writeFile(saveUri, Buffer.from(finalCode, 'utf8'));
		await vscode.window.showTextDocument(saveUri);
	});

	// --- Otros comandos (explain, modify, propose) ---
	// (Se omite el código por brevedad, pero la lógica interna para llamar a la IA
	// debería ser reemplazada por una llamada a `callAgentBackend` como en los ejemplos de arriba)
	const explainCodeCommand = vscode.commands.registerCommand('agente-limpio.explainCode', () => { /* ... */ });
	const modifyCodeCommand = vscode.commands.registerCommand('agente-limpio.modifyCode', async () => { /* ... */ });
	const proposeAndRefactorCommand = vscode.commands.registerCommand('agente-limpio.proposeAndRefactor', async () => { /* ... */ });


	context.subscriptions.push(searchProjectCommand, runTerminalCommand, openChatCommand, createCodeCommand, explainCodeCommand, modifyCodeCommand, proposeAndRefactorCommand);
}

// ¡NUEVA FUNCIÓN! Esta es la única función que habla con nuestro cerebro en Python.
async function callAgentBackend(prompt: string, model: string): Promise<string> {
	try {
        const { default: fetch } = await import('node-fetch');
		const response = await fetch(AGENT_BACKEND_URL, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				model: model, // Le decimos al backend qué modelo usar
				prompt: prompt
			})
		});

		if (!response.ok) {
			const errorText = await response.text();
			return `Error del servidor del Agente: ${response.status} - ${errorText}`;
		}

		const responseData = await response.json();
        return (responseData as { response: string }).response;

	} catch (error: any) {
		console.error("Error al conectar con el backend del Agente:", error);
		return `Error de conexión: No se pudo conectar con el backend del Agente en ${AGENT_BACKEND_URL}. ¿Está corriendo?`;
	}
}

function getWebviewContent() {
	return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Chat con Agente</title><style>body,html{height:100%;margin:0;padding:0;overflow:hidden;font-family:var(--vscode-font-family);color:var(--vscode-editor-foreground);background-color:var(--vscode-editor-background)}#chat-container{display:flex;flex-direction:column;height:100%}#chat-log{flex-grow:1;overflow-y:auto;padding:10px}.message{margin-bottom:10px;padding:8px 12px;border-radius:18px;max-width:80%;line-height:1.4}.user-message{background-color:var(--vscode-button-background);align-self:flex-end;margin-left:auto}.agent-message{background-color:var(--vscode-input-background);align-self:flex-start;white-space:pre-wrap}.typing-indicator{font-style:italic;color:var(--vscode-descriptionForeground)}#input-area{display:flex;padding:10px;border-top:1px solid var(--vscode-side-bar-border)}#prompt-input{flex-grow:1;border:1px solid var(--vscode-input-border);background-color:var(--vscode-input-background);color:var(--vscode-input-foreground);border-radius:5px;padding:8px}#send-button{margin-left:10px;border:none;background-color:var(--vscode-button-background);color:var(--vscode-button-foreground);cursor:pointer;padding:8px 15px;border-radius:5px}#send-button:hover{background-color:var(--vscode-button-hoverBackground)}</style></head><body><div id="chat-container"><div id="chat-log"></div><div id="input-area"><input type="text" id="prompt-input" placeholder="Escribe tu mensaje..."/><button id="send-button">Enviar</button></div></div><script>const vscode=acquireVsCodeApi(),chatLog=document.getElementById("chat-log"),promptInput=document.getElementById("prompt-input"),sendButton=document.getElementById("send-button");function addMessage(e,t){const o=document.createElement("div");o.className="message "+t+"-message",o.textContent=e,chatLog.appendChild(o),chatLog.scrollTop=chatLog.scrollHeight}function sendMessage(){const e=promptInput.value;e&&(addMessage(e,"user"),vscode.postMessage({command:"askAgent",text:e}),promptInput.value="")}sendButton.addEventListener("click",sendMessage),promptInput.addEventListener("keyup",(e=>{if("Enter"===e.key)sendMessage()})),window.addEventListener("message",(e=>{const t=e.data;switch(t.command){case"agentResponse":const e=document.querySelector(".typing-indicator");e&&e.remove(),addMessage(t.text,"agent");break;case"agentThinking":addMessage("El agente está escribiendo...","agent typing-indicator")}}));</script></body></html>`;
}

export function deactivate() {}