# Factory concepts in plain language

These explanations are general guidance. They do not establish the current state or capability of a particular machine.

## FX

**FX means OPC UA Field eXchange (UAFX).** It provides a common way for industrial automation devices, such as PLCs and robot controllers, to describe their functions and exchange process data. Its process-data connections use OPC UA PubSub.

Simply: **FX (OPC UA Field eXchange)** gives machines a common way to understand and exchange automation data.

Example: a conveyor controller shares a part-ready signal with a robot controller using agreed data and connection descriptions.

In this app: **Operations → FX & TSN** shows reported components and connections. A model or a connection shown on screen does not prove a physical control connection is commissioned.

## TSN

**TSN means Time-Sensitive Networking.** It is a set of Ethernet capabilities for predictable delivery of time-critical traffic. Depending on the equipment and profile, it can synchronize clocks, schedule traffic and manage competing network traffic.

Simply: **TSN (Time-Sensitive Networking)** helps important machine messages arrive predictably on an Ethernet network.

Example: control messages have scheduled transmission opportunities while ordinary file transfers share the same network.

In this app: the FX & TSN workspace displays reported clock and timing evidence. Its Demo scenarios are simulated; this dashboard does not configure physical switches or certify timing guarantees.

## FX and TSN together

**FX describes the automation data and its connections; TSN supplies network timing capabilities.** They address different parts of communication and can be used together. An FX connection alone does not establish a deterministic network, and UAFX can also use best-effort or prioritized Ethernet.

Example: FX describes a conveyor-to-robot process-data connection, while an appropriately configured TSN network helps that traffic meet its timing requirements.

In this app: look at **Operations → FX & TSN** for connections, clocks and timing. Demo data is authored simulation. Real timing claims need compatible hardware, configuration and measured evidence; no such capability can be inferred from a 3D model or this conversation.

## AAS

**AAS means Asset Administration Shell.** It is a structured digital description of an industrial asset: its identity, properties, capabilities and related information. Submodels organize subjects such as identification or technical data.

Example: a pump’s AAS can identify the pump and organize its technical specifications and documentation.

In this app: open the item in **Assets & devices** to inspect its authorized information. A digital description alone does not prove that the physical asset is connected or healthy.

## AASX

**An AASX file is a package used to exchange Asset Administration Shell information and associated files.** The AAS is the structured asset description; AASX is a way to package and transfer it.

Example: a supplier provides a pump’s AAS and supporting documentation in one AASX package.

In this app: an authorized individual engineer can review an AASX import in **Assets & devices**. Shared demo accounts cannot import or change operational records.

## MQTT

**MQTT is a publish/subscribe messaging protocol.** A publisher sends messages to a broker under a topic, and subscribers receive messages for topics they subscribe to.

Example: a gateway publishes a motor’s temperature; the telemetry service subscribes to its approved topic and stores accepted readings.

In this app: MQTT is a telemetry transport. A broker connection does not establish that every child sensor is live, and MQTT messaging does not itself provide a deterministic control loop.

## OPC UA

**OPC UA is an industrial interoperability framework.** It provides common information models and communication services so applications can exchange machine data with its meaning and structure.

Example: an application reads a machine’s named variables from an OPC UA server. OPC UA FX extends this framework for field-level automation communication.

In this app: ordinary OPC UA polling is a telemetry path; it is not automatically an FX process-data connection or proof of TSN timing.

## Gateway

**A gateway connects equipment or sensors to another system.** It can translate protocols or collect measurements and forward them with the source’s identity.

Example: a gateway reads a sensor over a local industrial protocol and forwards accepted telemetry to this application.

In this app: a receiving gateway and a receiving child sensor are separate claims. Inspect the particular item’s observations and timestamps before treating it as live.

## Telemetry

**Telemetry is recorded measurement or status data from a source.** A useful reading includes the value, unit, source, observation time and quality, so you can judge what it means.

Example: “42 °C, observed by temperature sensor A at a recorded time” is more informative than an unexplained number.

In this app: charts retain gaps, units and evidence labels. A historical or simulated reading is not proof of a current physical measurement.

## Demo and Live data

**Demo data is authored simulation; Live data is authorized operational evidence.** A demo can show how a workflow behaves without connecting to a real machine.

Example: a simulated high-temperature incident demonstrates investigation without asserting that a physical pump is overheating.

In this app: shared demo accounts can use the **Editable demo** to make and reset simulated changes in their browser. The reference dataset and operational records remain protected. Live access requires an individual operational account on a private installation; changing a stored preference cannot grant access.

## Incidents and acknowledgement

**An incident records a reported problem or condition. Acknowledging it means someone has seen it; resolving it is a separate action with its own evidence.** An alert is a reason to investigate, not proof of a physical cause.

Example: acknowledging a temperature warning does not mean the equipment has cooled or the cause has been repaired.

In this app: review the incident’s source, threshold, units, timestamps and evidence mode in **Alerts**. Historical and simulated examples remain labelled.

## Unknown and stale status

**Unknown means the available evidence cannot establish a current state. Stale means a recorded observation is too old for the applicable freshness policy.** Neither means healthy, and neither alone proves a physical failure.

Example: an old sensor reading may remain useful as history while being insufficient to show that the sensor is receiving now.

In this app: inspect observation time, source and freshness policy in the item’s detail view. A configured connection or gateway heartbeat is not a substitute for that item’s own evidence.

## 3D models

**A 3D model is a visual representation of equipment.** It helps you recognize equipment and navigate its related records; its appearance does not prove physical movement, connectivity or condition.

Example: selecting a robot on the factory floor opens that robot’s recorded details without changing the factory-wide totals or trend scope.

In this app: models load automatically where rendering is supported. The interactive floor plan preserves item selection and navigation when 3D is unavailable.

## Cybersecurity

**Cybersecurity is the protection of systems, devices and information against unauthorized access or disruption.** An assessment needs evidence about the relevant controls and threats, not just an online indicator.

Example: a device responding on the network does not prove that its software is patched or that access is appropriately restricted.

In this app: **Cybersecurity** shows recorded coverage and findings. Unknown controls stay unknown, simulated findings stay labelled, and no remediation is performed by the Assistant.

## Temperature

**Temperature describes how hot or cold something is.** In this app it is displayed in degrees Celsius (°C) when the source unit is verified. A value needs its equipment, acquisition time and context before it can be interpreted.

Example: a stored 85 °C bearing reading is an observation; it does not, on its own, establish a fault or current condition.

## Humidity

**Humidity describes moisture in air.** Relative humidity is expressed as a percentage (%), compared with what the air can hold at that temperature.

## Vibration

**Vibration describes repeated mechanical movement.** The app's canonical vibration measurement is velocity in mm/s. Values from acceleration sensors require compatible meaning and units; they cannot be treated as velocity without a supported conversion.

## Pressure

**Pressure is force applied over an area.** The app uses pascals (Pa) as its canonical pressure unit. A source expressed in bar needs an explicit verified conversion.

## Power

**Power is the rate of energy use or transfer.** The app's canonical unit is watts (W). Power is different from cumulative energy consumption, which also depends on time.

## Rpm

**RPM means revolutions per minute.** It describes rotational speed: 1,500 rpm means 1,500 complete turns in one minute.

## Reference material

The detailed [FX and TSN guide](fx-tsn.md) links to [OPC Foundation Part 81](https://reference.opcfoundation.org/specs/OPC-10000-81/5.5.6.1) and the [IEEE industrial TSN profile](https://1.ieee802.org/tsn/iec-ieee-60802/). Consult the focused application guides for actual workflows and commissioning requirements.
