/**
 * BIBLIOTECA - Exercícios disponíveis para a montagem automática de treinos.
 *
 * Usada pelo orientacao-service.js para montar rotinas com foco. O formato é o
 * mesmo do PLANO: tuplas [nome, grupoMuscular, series, min, max]. Os nomes de
 * grupo são exatamente os valores de 'grupoMuscular' já usados no app, para os
 * relatórios e filtros continuarem funcionando.
 *
 * Perfil de equipamento: halteres, máquinas e cabos (o mesmo nível do PLANO).
 * Exercícios novos só entram no banco quando uma rotina que os referencia é
 * aplicada - o sincronizarCatalogo cria no store 'exercises' automaticamente.
 */

const BIBLIOTECA = {
  "Peito": [
    ["Supino com Halteres", "Peito", 4, 6, 12],
    ["Supino Inclinado / Variação", "Peito", 3, 8, 15],
    ["Crucifixo com Halteres", "Peito", 3, 10, 15],
    ["Supino Inclinado com Halteres", "Peito", 3, 8, 12],
    ["Supino Reto na Máquina", "Peito", 3, 10, 15],
    ["Peck Deck", "Peito", 3, 12, 20],
    ["Crucifixo na Polia", "Peito", 3, 12, 18],
    ["Flexão de Braço", "Peito", 3, 8, 15],
    ["Supino Inclinado na Máquina", "Peito", 3, 10, 15],
    ["Flexão de Braço com Pés Elevados", "Peito", 3, 8, 15]
  ],
  "Costas": [
    ["Remada Curvada com Halteres", "Costas", 4, 8, 12],
    ["Remada Unilateral", "Costas", 3, 8, 15],
    ["Pullover com Halter", "Costas", 3, 10, 15],
    ["Remada Curvada", "Costas", 3, 8, 12],
    ["Puxada Aberta na Máquina", "Costas", 4, 8, 12],
    ["Puxada Fechada na Máquina", "Costas", 3, 10, 15],
    ["Remada na Polia Baixa", "Costas", 3, 10, 15],
    ["Remada na Máquina", "Costas", 3, 10, 15],
    ["Remada Alta com Halteres", "Costas", 3, 10, 15],
    ["Máquina de Dominadas Assistidas", "Costas", 4, 6, 12]
  ],
  "Ombros": [
    ["Desenvolvimento com Halteres", "Ombros", 3, 8, 12],
    ["Elevação Lateral", "Ombros", 4, 12, 20],
    ["Desenvolvimento na Máquina", "Ombros", 3, 10, 15],
    ["Elevação Lateral na Polia", "Ombros", 3, 12, 20],
    ["Elevação Frontal com Halteres", "Ombros", 3, 12, 20],
    ["Desenvolvimento Arnold", "Ombros", 3, 8, 12],
    ["Elevação Lateral Inclinada", "Ombros", 3, 12, 20]
  ],
  "Ombro Posterior": [
    ["Crucifixo Inverso", "Ombro Posterior", 4, 12, 20],
    ["Elevação Posterior na Máquina", "Ombro Posterior", 3, 12, 20],
    ["Crucifixo Inverso na Polia", "Ombro Posterior", 3, 12, 20],
    ["Elevação Posterior com Halteres", "Ombro Posterior", 3, 12, 20],
    ["Crucifixo Inverso Sentado com Halteres", "Ombro Posterior", 3, 12, 20]
  ],
  "Tríceps": [
    ["Tríceps Francês", "Tríceps", 3, 10, 15],
    ["Tríceps Testa", "Tríceps", 3, 10, 15],
    ["Tríceps na Polia", "Tríceps", 3, 10, 15],
    ["Tríceps na Corda", "Tríceps", 3, 12, 20],
    ["Tríceps com Halter (coice)", "Tríceps", 3, 10, 15],
    ["Tríceps na Máquina", "Tríceps", 3, 10, 15],
    ["Mergulho na Máquina", "Tríceps", 3, 8, 12],
    ["Mergulho entre Bancos", "Tríceps", 3, 8, 15]
  ],
  "Bíceps": [
    ["Rosca Alternada", "Bíceps", 3, 8, 12],
    ["Rosca Martelo", "Bíceps", 3, 10, 15],
    ["Rosca Concentrada", "Bíceps", 3, 10, 15],
    ["Rosca na Máquina", "Bíceps", 3, 10, 15],
    ["Rosca Inclinada com Halteres", "Bíceps", 3, 10, 15],
    ["Rosca na Polia Baixa", "Bíceps", 3, 12, 20],
    ["Rosca Scott com Halteres", "Bíceps", 3, 8, 12]
  ],
  "Quadríceps": [
    ["Agachamento Goblet", "Quadríceps", 4, 10, 15],
    ["Afundo com Halteres", "Quadríceps", 3, 8, 12],
    ["Cadeira Extensora", "Quadríceps", 4, 10, 15],
    ["Agachamento Búlgaro", "Quadríceps", 4, 8, 12],
    ["Leg Press", "Quadríceps", 4, 10, 15],
    ["Cadeira Extensora Unilateral", "Quadríceps", 3, 12, 18],
    ["Afundo Caminhando com Halteres", "Quadríceps", 3, 10, 15],
    ["Step Up com Halteres", "Quadríceps", 3, 10, 15]
  ],
  "Posterior": [
    ["Terra Romeno com Halteres", "Posterior", 4, 8, 12],
    ["Elevação Pélvica", "Posterior", 3, 10, 15],
    ["Terra Romeno", "Posterior", 4, 8, 12],
    ["Cadeira Flexora", "Posterior", 4, 10, 15],
    ["Mesa Flexora", "Posterior", 3, 10, 15],
    ["Elevação Pélvica na Máquina", "Posterior", 3, 10, 15],
    ["Good Morning com Halteres", "Posterior", 3, 10, 15],
    ["Stiff com Halteres", "Posterior", 3, 8, 12]
  ],
  "Panturrilha": [
    ["Panturrilha", "Panturrilha", 4, 12, 20],
    ["Panturrilha em Pé na Máquina", "Panturrilha", 4, 12, 20],
    ["Panturrilha Sentada na Máquina", "Panturrilha", 4, 12, 20],
    ["Panturrilha no Leg Press", "Panturrilha", 4, 12, 20],
    ["Elevação de Panturrilha com Halteres", "Panturrilha", 4, 12, 20],
    ["Panturrilha Unilateral com Halter", "Panturrilha", 4, 12, 20],
    ["Panturrilha Sentada com Halter", "Panturrilha", 4, 12, 20]
  ],
  "Abdômen": [
    ["Abdominal", "Abdômen", 3, 12, 20],
    ["Abdominal na Máquina", "Abdômen", 3, 10, 15],
    ["Elevação de Pernas", "Abdômen", 3, 10, 15],
    ["Abdominal Bicicleta", "Abdômen", 3, 15, 25],
    ["Crunch na Polia", "Abdômen", 3, 12, 20],
    ["Abdominal Crunch com Halter", "Abdômen", 3, 10, 15]
  ]
};

export { BIBLIOTECA };
