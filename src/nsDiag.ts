'use strict';

import path from "path";
import fs from "fs";

import {
    commands,
    ExtensionContext,
    Diagnostic,
    DiagnosticCollection,
    DiagnosticSeverity,
    languages,
    Position,
    Range,
    TextDocument,
    Uri,
    workspace
} from "vscode";

import { logger } from "./logger";
import { isArray } from "f5-conx-core";

export type DiagRule = {
    code: string;
    severity: "Error" | "Warning" | "Information" | "Hint";
    title: string;
    message: string;
    regex: string;
    category?: "ssl_tls" | "load_balancing" | "persistence" | "monitoring" | "security" | "performance" | "compatibility" | "networking" | "policies";
    technology?: "XC" | "TMOS" | "NGINX" | "General";
    description?: string;
};



export class NsDiag {
    public enabled: boolean = true;
    public lastDoc: TextDocument | undefined = undefined;

    public diagXC: DiagnosticCollection;

    settingsFileLocation: string;
    rules: DiagRule[];

    // countDefualtRedirect: boolean = false;

    constructor(context: ExtensionContext) {
        // create diag collection
        this.diagXC = languages.createDiagnosticCollection('f5-ns-diag');

        this.settingsFileLocation = path.join(context.extensionPath, 'diagnostics.json');
        this.rules = this.loadRules();

        context.subscriptions.push(
            workspace.onDidChangeTextDocument(e => this.updateDiagnostic(e.document))
        );

        context.subscriptions.push(
            workspace.onDidCloseTextDocument(doc => this.diagXC.delete(doc.uri))
        );

    }

    loadRules() {
        logger.info("loading ns diagnosics rules file");
        return this.rules = JSON.parse(fs.readFileSync(this.settingsFileLocation).toString());
    }

    openRules() {
        // const loc = path.join(context.Extens)
        // workspace.openTextDocument(this.settingsFileLocation);
        logger.info("opening ns->f5 diagnostic rules file");
        return commands.executeCommand("vscode.open", Uri.file(this.settingsFileLocation));
        // workbench.action.files.openFile
    }

    /**
     * recursive function to dig config for diagnostics
     * @param text 
     * @param diags (optional, only called from itself)
     * @returns array of diagnostics
     */
    getDiagnostic(text: string | string[], diags: Diagnostic[] = []): Diagnostic[] {

        if (isArray(text)) {

            // recast the type as array
            const apps = text as string[];

            // loop through apps
            apps.forEach(app => {

                // get diagnostics for app, but use the same diagnostic array
                diags = this.getDiagnostic(app, diags);

            });

        } else {

            // recast the type as string
            text = text as string;

            // if we don't have any app exclusions (this just excludes the app from diagnostics)
            // if (this.getDiagnosticExlusion(text).reasons.length === 0 && text) {

            // split the config into lines
            const lines = text.split('\n');

            lines.forEach((value, index) => {

                // loop through rules on each line
                this.rules.forEach(rule => {

                    // if rule empty, pass
                    if (rule.regex === '') { return; }

                    try {
                        // look for rule regex
                        const match = value.match(rule.regex);

                        if (match) {

                        // set rule severity
                        const severity
                            = rule.severity === "Error" ? DiagnosticSeverity.Error
                                : rule.severity === "Warning" ? DiagnosticSeverity.Warning
                                    : rule.severity === "Information" ? DiagnosticSeverity.Information
                                        : DiagnosticSeverity.Hint;

                        // push diagnostic
                        diags.push({
                            code: rule.code,
                            message: rule.message,
                            range: new Range(
                                new Position(index, match.index || 0),
                                new Position(index, match[0].length + (match.index || 0))
                            ),
                            severity
                        });

                        }
                    } catch (error) {
                        // Log regex error but don't crash the diagnostic process
                        logger.warn(`Diagnostic rule ${rule.code} has invalid regex: ${rule.regex}. Error: ${error}`);
                    }
                });
            });
            // }


        }

        return diags;
    }

    getDiagStats(diags: Diagnostic[]) {

        const stats: {
            Error?: number;
            Warning?: number;
            Information?: number;
            Hint?: number
        } = {};

        diags.forEach((d) => {

            if (d.severity === 0) {
                if (stats.Error) {
                    stats.Error = stats.Error + 1;
                } else {
                    stats.Error = 1;
                }
            }

            if (d.severity === 1) {
                if (stats.Warning) {
                    stats.Warning = stats.Warning + 1;
                } else {
                    stats.Warning = 1;
                }
            }

            if (d.severity === 2) {
                if (stats.Information) {
                    stats.Information = stats.Information + 1;
                } else {
                    stats.Information = 1;
                }
            }

            if (d.severity === 3) {
                if (stats.Hint) {
                    stats.Hint = stats.Hint + 1;
                } else {
                    stats.Hint = 1;
                }
            }


        });

        return stats;
    }

    /**
     * Get rule statistics by category and technology
     * @returns Object with rule counts by category and technology
     */
    getRuleStats() {
        const stats = {
            total: this.rules.length,
            byTechnology: { XC: 0, TMOS: 0, NGINX: 0, General: 0 },
            byCategory: {
                ssl_tls: 0,
                load_balancing: 0,
                persistence: 0,
                monitoring: 0,
                security: 0,
                performance: 0,
                compatibility: 0,
                networking: 0,
                policies: 0
            },
            bySeverity: { Error: 0, Warning: 0, Information: 0, Hint: 0 },
            activeRules: 0
        };

        this.rules.forEach(rule => {
            // Count severity
            stats.bySeverity[rule.severity]++;

            // Count active rules (non-empty regex)
            if (rule.regex && rule.regex.trim() !== '') {
                stats.activeRules++;
            }

            // Count by technology (inferred from title prefix)
            if (rule.title.startsWith('XC-')) {
                stats.byTechnology.XC++;
            } else if (rule.title.startsWith('TMOS-')) {
                stats.byTechnology.TMOS++;
            } else if (rule.title.startsWith('NGINX-')) {
                stats.byTechnology.NGINX++;
            } else {
                stats.byTechnology.General++;
            }

            // Count by category (if specified)
            if (rule.category) {
                stats.byCategory[rule.category]++;
            }
        });

        return stats;
    }

    updateDiagnostic(doc: TextDocument) {

        if (doc.fileName === 'app.ns.conf' || doc.fileName === 'app.ns.json') {

            // clear current diags in this class
            this.diagXC.clear();
            // clear the current diags in the doc/editor
            this.diagXC.delete(doc.uri);

            if (this.enabled) {

                // capture the doc we are working with
                this.lastDoc = doc;

                // get the text from the doc/editor and feed through xc diagnostics
                const diags = this.getDiagnostic(doc.getText());

                // pubish the diags to document
                this.diagXC.set(doc.uri, diags);
            }

        }
    }
}

