class CalculatorPlugin {
  async init(api) {
    this.api = api;
    this.api.logger.info('Plugin de Calculadora Rápida ativo.');

    this.api.registerTool({
      name: 'calculate',
      description: 'Calcula uma expressão matemática simples.',
      parameters: { expression: 'string' },
      execute: async ({ expression }) => {
        try {
          // Avaliação matemática segura
          const cleanExp = String(expression || '').replace(/[^0-9+\-*/().\s]/g, '');
          if (!cleanExp) return { result: 'Expressão inválida' };
          const result = Function(`"use strict"; return (${cleanExp})`)();
          return { expression: cleanExp, result };
        } catch (err) {
          return { error: 'Expressão matemática inválida' };
        }
      }
    });
  }
}

module.exports = CalculatorPlugin;
