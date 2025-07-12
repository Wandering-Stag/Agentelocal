import * as vscode from 'vscode';
import * as path from 'path';
import { exec } from 'child_process';

export function activate(context: vscode.ExtensionContext) {

	console.log('¡Felicidades, tu extensión "agente-limpio" está ahora activa!');

	const outputChannel = vscode.window.createOutputChannel("Salida del Agente");

	// --- ¡NUEVO COMANDO! Para buscar en todo el proyecto (LÓGICA MEJORADA) ---
	const searchProjectCommand = vscode.commands.registerCommand('agente-limpio.searchProject', async () => {
		const query = await vscode.window.showInputBox({ prompt: "¿Qué quieres buscar en el proyecto?" });
		if (!query) { return; }

		vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Buscando "${query}"...` }, async () => {
			const findings = new Map<string, string>(); // Usamos un Map para no repetir archivos

			// 1. Buscar en los archivos ya abiertos
			for (const document of vscode.workspace.textDocuments) {
				if (document.uri.scheme === 'file') { // Solo buscar en archivos reales del disco
					const text = document.getText();
					if (text.toLowerCase().includes(query.toLowerCase())) {
						const relativePath = vscode.workspace.asRelativePath(document.uri.fsPath);
						findings.set(relativePath, `Encontrado en (archivo abierto): ${relativePath}\n`);
					}
				}
			}

			// 2. Buscar en el resto de archivos del proyecto
			const files = await vscode.workspace.findFiles('**/*.*', '**/node_modules/**');
			for (const file of files) {
				const relativePath = vscode.workspace.asRelativePath(file.fsPath);
				if (findings.has(relativePath)) continue; // Si ya lo encontramos, no lo procesamos de nuevo

				try {
					const document = await vscode.workspace.openTextDocument(file);
					const text = document.getText();
					if (text.toLowerCase().includes(query.toLowerCase())) {
						findings.set(relativePath, `Encontrado en: ${relativePath}\n`);
					}
				} catch (e) {
					// Ignorar errores al abrir archivos binarios, etc.
				}
			}

			outputChannel.clear();
			outputChannel.appendLine(`Resultados de la búsqueda para "${query}":\n`);
			if (findings.size > 0) {
				for (const find of findings.values()) {
					outputChannel.appendLine(find);
				}
			} else {
				outputChannel.appendLine('No se encontraron resultados.');
			}
			outputChannel.show();
		});
	});

	// --- ¡NUEVO COMANDO! Para ejecutar comandos de terminal de forma segura ---
	const runTerminalCommand = vscode.commands.registerCommand('agente-limpio.runTerminal', async () => {
		const commandToRun = await vscode.window.showInputBox({ prompt: "Escribe el comando de terminal que quieres que el agente ejecute", placeHolder: "Ej: npm install express" });
		if (!commandToRun) { return; }

		const userConfirmation = await vscode.window.showWarningMessage(
			`¿Estás seguro de que quieres ejecutar el siguiente comando en la terminal?\n\n> ${commandToRun}`,
			{ modal: true }, "Sí, ejecutar"
		);
		if (userConfirmation !== "Sí, ejecutar") {
			vscode.window.showInformationMessage("Comando cancelado.");
			return;
		}

		vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Ejecutando: ${commandToRun}` }, async () => {
			const workspaceFolder = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath : undefined;
			exec(commandToRun, { cwd: workspaceFolder }, (error, stdout, stderr) => {
				outputChannel.clear();
				if (error) {
					outputChannel.appendLine(`ERROR al ejecutar el comando:\n${error.message}`);
					outputChannel.show(); return;
				}
				if (stderr) { outputChannel.appendLine(`Salida de error (stderr):\n${stderr}`); }
				outputChannel.appendLine(`Salida del comando (stdout):\n${stdout}`);
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
					const agentResponse = await callOllama(message.text, 'codegemma');
					panel.webview.postMessage({ command: 'agentResponse', text: agentResponse });
				}
			}
		);
	});

	// --- Comando para CREAR código desde cero ---
	const createCodeCommand = vscode.commands.registerCommand('agente-limpio.createCode', async () => {
		const description = await vscode.window.showInputBox({ prompt: "Describe el código que quieres crear.", placeHolder: "Ej: una clase Calculadora en Python con métodos para sumar, restar, etc." });
		if (!description) { return; }
		const draftPrompt = `Eres un programador. Basado en la siguiente descripción, genera un borrador de código completo y funcional. Descripción: "${description}"`;
		let draftCode = '';
		await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "El cerebro creativo está generando un borrador..." }, async () => {
			draftCode = await callOllama(draftPrompt, 'gemma:2b');
		});
		const refinePrompt = `Eres un programador experto. Revisa y refina el siguiente borrador de código para asegurar que es de alta calidad, está bien comentado y es correcto. Borrador:\n\`\`\`\n${draftCode}\n\`\`\`\nProporciona únicamente el código final y refinado, sin explicaciones.`;
		let finalCode = '';
		await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "El programador experto está refinando el código..." }, async () => {
			finalCode = await callOllama(refinePrompt, 'codegemma');
			finalCode = finalCode.replace(/^```[\s\S]*?\n/, '').replace(/```$/, '');
		});
		const saveUri = await vscode.window.showSaveDialog({ title: "Guardar el nuevo archivo de código", saveLabel: "Guardar Archivo" });
		if (!saveUri) { vscode.window.showInformationMessage("Creación de archivo cancelada."); return; }
		await vscode.workspace.fs.writeFile(saveUri, Buffer.from(finalCode, 'utf8'));
		await vscode.window.showTextDocument(saveUri);
		vscode.window.showInformationMessage(`¡Archivo creado con éxito en "${saveUri.fsPath}"!`);
	});

	// --- Comando para EXPLICAR código (solo lectura) ---
	const explainCodeCommand = vscode.commands.registerCommand('agente-limpio.explainCode', () => {
		const editor = vscode.window.activeTextEditor;
		if (editor) {
			const selection = editor.document.getText(editor.selection);
			if (selection) {
				const fullPrompt = `Por favor, explica el siguiente fragmento de código de forma clara y concisa:\n\`\`\`\n${selection}\n\`\`\``;
				vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "El Agente está analizando el código..." }, async () => {
					const agentResponse = await callOllama(fullPrompt, 'codegemma');
					vscode.window.showInformationMessage(`Explicación del Agente: ${agentResponse}`, { modal: true });
				});
			}
		}
	});

	// --- Comando para MODIFICAR código (simple) ---
	const modifyCodeCommand = vscode.commands.registerCommand('agente-limpio.modifyCode', async () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor) { return; }
		const selection = editor.selection;
		const selectedText = editor.document.getText(selection);
		if (!selectedText) { return; }
		const modificationRequest = await vscode.window.showInputBox({ prompt: "¿Qué modificación quieres hacer en el código seleccionado?" });
		if (!modificationRequest) { return; }
		const fullPrompt = `Tarea: El usuario quiere modificar un fragmento de código.\nPetición: "${modificationRequest}"\nCódigo original:\n\`\`\`\n${selectedText}\n\`\`\`\nProporciona únicamente el código modificado, sin explicaciones.`;
		vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "El Agente está modificando el código..." }, async () => {
			const agentResponse = await callOllama(fullPrompt, 'codegemma');
			editor.edit(editBuilder => { editBuilder.replace(selection, agentResponse); });
			vscode.window.showInformationMessage("¡El código ha sido modificado!");
		});
	});

	// --- Comando de DOBLE CEREBRO y VERIFICACIÓN ---
	const proposeAndRefactorCommand = vscode.commands.registerCommand('agente-limpio.proposeAndRefactor', async () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor) { return; }
		const selection = editor.selection;
		const selectedText = editor.document.getText(selection);
		if (!selectedText) { return; }
		const modificationRequest = await vscode.window.showInputBox({ prompt: "¿Cuál es tu objetivo para este código?", placeHolder: "Ej: hacerlo más legible, optimizar el rendimiento, etc." });
		if (!modificationRequest) { return; }
		const brainstormingPrompt = `Tengo el siguiente código:\n\`\`\`\n${selectedText}\n\`\`\`\nMi objetivo es: "${modificationRequest}".\nDame 3 estrategias diferentes para lograrlo. IMPORTANTE: Formatea tu respuesta como una lista numerada. Cada opción debe empezar con un número seguido de un punto (ej: "1. ...").`;
		let ideas = '';
		await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "El cerebro creativo está generando ideas..." }, async () => {
			ideas = await callOllama(brainstormingPrompt, 'gemma:2b');
		});
		console.log("Respuesta cruda de gemma:2b:", ideas);
		const ideaOptions = ideas.split('\n').filter(line => line.trim().match(/^(\d\.|-|\*)\s?/)).map(line => line.trim());
		if (ideaOptions.length === 0) {
			vscode.window.showErrorMessage("El agente creativo no pudo generar ideas claras. Revisa la consola de depuración para ver la respuesta cruda e inténtalo de nuevo.");
			return;
		}
		const chosenIdea = await vscode.window.showQuickPick(ideaOptions, { placeHolder: "Elige un enfoque para refactorizar" });
		if (!chosenIdea) { return; }
		const executionPrompt = `Tarea: Refactorizar un fragmento de código siguiendo un enfoque específico.\nCódigo original:\n\`\`\`\n${selectedText}\n\`\`\`\nEnfoque elegido: "${chosenIdea}"\nREGLAS MUY IMPORTANTES:\n1. Tu respuesta debe ser ÚNICAMENTE el código final refactorizado.\n2. NO incluyas explicaciones, comentarios, ni la etiqueta de bloque de código (\`\`\`).\n3. NO inventes funciones o métodos que no existían. Solo debes reemplazar la lógica interna del código original.\n4. Asegúrate de que el código que generas es sintácticamente correcto y no tiene errores.`;
		let agentResponse = '';
		await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "El programador experto está escribiendo el código..." }, async () => {
			agentResponse = await callOllama(executionPrompt, 'codegemma');
		});
		const verificationPrompt = `Contexto: He generado un fragmento de código para un usuario.\nCódigo Original:\n\`\`\`\n${selectedText}\n\`\`\`\nCódigo Generado:\n\`\`\`\n${agentResponse}\n\`\`\`\nTarea de Verificación:\n1. ¿El "Código Generado" es sintácticamente correcto y no contiene errores obvios?\n2. ¿El "Código Generado" cumple con el objetivo de refactorización: "${chosenIdea}"?\nPor favor, responde en el siguiente formato:\nVeredicto: [SÍ/NO]\nExplicación: [Tu explicación breve aquí]`;
		let verificationResult = '';
		await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "El agente está verificando su propio trabajo..." }, async () => {
			verificationResult = await callOllama(verificationPrompt, 'codegemma');
		});
		const userConfirmation = await vscode.window.showInformationMessage(
			`VERIFICACIÓN DEL AGENTE:\n\n${verificationResult}\n\n¿Quieres aplicar este cambio?`,
			{ modal: true }, "Aplicar Cambio", "Cancelar"
		);
		if (userConfirmation === "Aplicar Cambio") {
			editor.edit(editBuilder => { editBuilder.replace(selection, agentResponse); });
			vscode.window.showInformationMessage("¡El código ha sido refactorizado!");
		} else {
			vscode.window.showInformationMessage("Refactorización cancelada.");
		}
	});

	context.subscriptions.push(searchProjectCommand, runTerminalCommand, openChatCommand, createCodeCommand, explainCodeCommand, modifyCodeCommand, proposeAndRefactorCommand);
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
	return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Chat con Agente</title><style>body,html{height:100%;margin:0;padding:10px;display:flex;flex-direction:column;font-family:var(--vscode-font-family);color:var(--vscode-editor-foreground);background-color:var(--vscode-editor-background)}textarea{flex-grow:1;width:98%;border:1px solid var(--vscode-input-border);background-color:var(--vscode-input-background);color:var(--vscode-input-foreground);font-family:var(--vscode-font-family);font-size:1.1em;padding:5px}button{margin-top:10px;border:none;padding:10px 15px;background-color:var(--vscode-button-background);color:var(--vscode-button-foreground);cursor:pointer;width:100%;font-size:1.1em}button:hover{background-color:var(--vscode-button-hoverBackground)}</style></head><body><textarea id="prompt-input" placeholder="Este panel es para preguntas generales sin contexto de código..."></textarea><button id="ask-button">Preguntar al Agente</button><script>const vscode=acquireVsCodeApi(),askButton=document.getElementById("ask-button"),promptInput=document.getElementById("prompt-input");askButton.addEventListener("click",(()=>{if(promptInput.value){vscode.postMessage({command:"askAgent",text:promptInput.value})}}));</script></body></html>`;
}

export function deactivate() {}