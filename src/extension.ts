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
						const agentResponse = await callOllama(message.text, 'codegemma');
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

	// --- ¡NUEVO COMANDO! Con el sistema de DOBLE CEREBRO y VERIFICACIÓN ---
	const proposeAndRefactorCommand = vscode.commands.registerCommand('agente-limpio.proposeAndRefactor', async () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor) { return; }
		const selection = editor.selection;
		const selectedText = editor.document.getText(selection);
		if (!selectedText) { return; }

		const modificationRequest = await vscode.window.showInputBox({ prompt: "¿Cuál es tu objetivo para este código?", placeHolder: "Ej: hacerlo más legible, optimizar el rendimiento, etc." });
		if (!modificationRequest) { return; }

		// 1. Lluvia de Ideas con gemma:2b
		const brainstormingPrompt = `Tengo el siguiente código:\n\`\`\`\n${selectedText}\n\`\`\`\nMi objetivo es: "${modificationRequest}".\nDame 3 estrategias diferentes para lograrlo. IMPORTANTE: Formatea tu respuesta como una lista numerada. Cada opción debe empezar con un número seguido de un punto (ej: "1. ...").`;
		
		let ideas = '';
		await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "El cerebro creativo está generando ideas..." }, async () => {
			ideas = await callOllama(brainstormingPrompt, 'gemma:2b');
		});

		console.log("Respuesta cruda de gemma:2b:", ideas);

		// 2. Presentar ideas al usuario
		const ideaOptions = ideas.split('\n').filter(line => line.trim().match(/^(\d\.|-|\*)\s?/)).map(line => line.trim()); 
		if (ideaOptions.length === 0) {
			vscode.window.showErrorMessage("El agente creativo no pudo generar ideas claras. Revisa la consola de depuración para ver la respuesta cruda e inténtalo de nuevo.");
			return;
		}

		const chosenIdea = await vscode.window.showQuickPick(ideaOptions, { placeHolder: "Elige un enfoque para refactorizar" });
		if (!chosenIdea) { return; }

		// 3. Ejecución con codegemma
		const executionPrompt = `Tarea: Refactorizar un fragmento de código siguiendo un enfoque específico.\nCódigo original:\n\`\`\`\n${selectedText}\n\`\`\`\nEnfoque elegido: "${chosenIdea}"\nREGLAS MUY IMPORTANTES:\n1. Tu respuesta debe ser ÚNICAMENTE el código final refactorizado.\n2. NO incluyas explicaciones, comentarios, ni la etiqueta de bloque de código (\`\`\`).\n3. NO inventes funciones o métodos que no existían. Solo debes reemplazar la lógica interna del código original.\n4. Asegúrate de que el código que generas es sintácticamente correcto y no tiene errores.`;

		let agentResponse = '';
		await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "El programador experto está escribiendo el código..." }, async () => {
			agentResponse = await callOllama(executionPrompt, 'codegemma');
		});

		// 4. ¡NUEVO! Paso de Verificación
		const verificationPrompt = `Contexto: He generado un fragmento de código para un usuario.\nCódigo Original:\n\`\`\`\n${selectedText}\n\`\`\`\nCódigo Generado:\n\`\`\`\n${agentResponse}\n\`\`\`\nTarea de Verificación:\n1. ¿El "Código Generado" es sintácticamente correcto y no contiene errores obvios?\n2. ¿El "Código Generado" cumple con el objetivo de refactorización: "${chosenIdea}"?\nPor favor, responde en el siguiente formato:\nVeredicto: [SÍ/NO]\nExplicación: [Tu explicación breve aquí]`;
		
		let verificationResult = '';
		await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "El agente está verificando su propio trabajo..." }, async () => {
			verificationResult = await callOllama(verificationPrompt, 'codegemma');
		});

		// 5. ¡NUEVO! Pedir confirmación al usuario
		const userConfirmation = await vscode.window.showInformationMessage(
			`VERIFICACIÓN DEL AGENTE:\n\n${verificationResult}\n\n¿Quieres aplicar este cambio?`,
			{ modal: true },
			"Aplicar Cambio",
			"Cancelar"
		);

		// 6. ¡NUEVO! Aplicar el cambio solo si el usuario confirma
		if (userConfirmation === "Aplicar Cambio") {
			editor.edit(editBuilder => {
				editBuilder.replace(selection, agentResponse);
			});
			vscode.window.showInformationMessage("¡El código ha sido refactorizado!");
		} else {
			vscode.window.showInformationMessage("Refactorización cancelada.");
		}
	});

	context.subscriptions.push(openPanelCommand, explainCodeCommand, modifyCodeCommand, proposeAndRefactorCommand);
}

// La función ahora acepta el nombre del modelo como parámetro
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
	return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Panel del Agente</title><style>body,html{height:100%;margin:0;padding:10px;display:flex;flex-direction:column;font-family:var(--vscode-font-family);color:var(--vscode-editor-foreground);background-color:var(--vscode-editor-background)}textarea{flex-grow:1;width:98%;border:1px solid var(--vscode-input-border);background-color:var(--vscode-input-background);color:var(--vscode-input-foreground);font-family:var(--vscode-font-family);font-size:1.1em;padding:5px}button{margin-top:10px;border:none;padding:10px 15px;background-color:var(--vscode-button-background);color:var(--vscode-button-foreground);cursor:pointer;width:100%;font-size:1.1em}button:hover{background-color:var(--vscode-button-hoverBackground)}</style></head><body><textarea id="prompt-input" placeholder="Este panel es para preguntas generales sin contexto de código..."></textarea><button id="ask-button">Preguntar al Agente</button><script>const vscode=acquireVsCodeApi(),askButton=document.getElementById("ask-button"),promptInput=document.getElementById("prompt-input");askButton.addEventListener("click",(()=>{if(promptInput.value){vscode.postMessage({command:"askAgent",text:promptInput.value})}}));</script></body></html>`;
}

export function deactivate() {}