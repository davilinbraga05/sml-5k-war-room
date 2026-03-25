# SML-24: Simulação Missão Logística [WAR ROOM]

Um protótipo avançado e interativo de Command Center com hiper-simulação, construído para suportar e visualizar **5.000 ativos logísticos** simultaneamente em um mapa. Foca na alta performance via WebGL, detecção de contingências, tráfego dinâmico e clusterização de ativos.

## 🚀 Tecnologias Integradas (Zero-Setup)

- **Vanilla JavaScript, HTML5 & CSS3:** Arquitetura ágil e de altíssima performance.
- **Deck.gl & Maplibre GL JS:** Renderização WebGL nativa a 60fps sobre um basemap Dark Mode.
- **Supercluster:** Agrupamento rápido de coordenadas para visualizar com eficiência aglomerados de caminhões em zooms distantes.
- **Chart.js:** Gráficos interativos renderizados em Canvas para exibir histórico de eficiência térmica e de malha temporal.
- **Tailwind CSS & Phosphor Icons (CDNs):** UI High-Tech moderna e limpa.

## ⚙️ Hiper-Simulação & Eventos

A aplicação conta com um **Motor de Simulação Analítico** que calcula o trajeto, combustível, temperatura de carga, e contingências a cada *tick*. Os ativos reagem em tempo real às seguintes regras de negócio:

### Contingências Orgânicas:
1. **Falha Mecânica (`MECHANICAL_FAILURE`):** Ícone vermelho, queda drástica na eficiência do OpEx, e alerta registrado com timestamp.
2. **Latência de Sinal (`CONNECTION_LOST`):** Simula perda temporal e pinta o caminhão de amarelo.
3. **Desvio de Rota / Geofencing (`ROUTE_DEVIATION`):** Laranja fluorescente para saídas do corredor.

### Controle Tático Operacional (Painel de Injeção):
- **Tráfego Intenso:** Possibilidade de forçar manualmente áreas de congestionamento virtual massivo (ex: Sorocaba). Veículos ao passarem pela área sofrem penalidade extrema na velocidade, coloração vermelha clara, e disparos de "Atraso no ETA".
- **Quebras Críticas:** Aciona mecanicamente a paralisação imediata de 5 veículos para testar os alertas do Command Center.
- **Limpeza de Malha:** Reinicia o status logístico e restaura o fluxo orgânico normal de simulação.

## 📊 Dashboard Diretor

O cabeçalho e rodapé abrigam o Business Intelligence integrado:
- **Custo Operacional Total/Hora:** Dinheiro gasto baseado em contingências e lentidão. 
- **Economia de Combustível:** Valor monetário economizado através de otimização de trajeto orgânico.
- **Painel de Desempenho Histórico:** O rodapé mostra a flutuação do KPI "Eficiência da Malha" plotado por uma linha cronológica viva.
- **Inspeção Direcionada:** Ao clicar em qualquer caminhão no mapa, visualiza-se imediatamente:
   - Velocidade instantânea, temperatura (ºC), consumo de bateria/tanque, coordenadas exatas e a **projeção visual ciano** do seu deslocamento futuro do traçado sobreposto no mapa.

## 💻 Como Executar

Por ser uma aplicação baseada em CDNs estáticas Vanilla JS, não há comandos de `npm` ou de instalação. 

Rode o Python HTTP Server embutido para permitir importações CORS:
```bash
python3 -m http.server 8000
```
Em seguida, acesse: [http://localhost:8000](http://localhost:8000)
