/**
 * Screen barrel: importing this module registers every screen in the
 * render registry (see core/rotas.js) and exposes them namespaced.
 */

import * as treino from './treino.js';
import * as medidas from './medidas.js';
import * as alimentacao from './alimentacao.js';
import * as relatorio from './relatorio.js';
import * as rotina from './rotina.js';
import * as foco from './foco.js';

export { treino, medidas, alimentacao, relatorio, rotina, foco };
