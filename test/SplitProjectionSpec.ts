import "reflect-metadata";
import expect = require("expect.js");
import * as TypeMoq from "typemoq";
import SplitProjectionRunner from "../scripts/projections/SplitProjectionRunner";
import {Observable, Scheduler, ReplaySubject, IDisposable, Subject} from "rx";
import {IStreamFactory} from "../scripts/streams/IStreamFactory";
import IReadModelFactory from "../scripts/streams/IReadModelFactory";
import {MockStreamFactory} from "./fixtures/MockStreamFactory";
import ReadModelFactory from "../scripts/streams/ReadModelFactory";
import SplitProjectionDefinition from "./fixtures/definitions/SplitProjectionDefinition";
import {Matcher} from "../scripts/matcher/Matcher";
import {Event} from "../scripts/streams/Event";
import {Snapshot} from "../scripts/snapshots/ISnapshotRepository";
import Dictionary from "../scripts/util/Dictionary";
import MockDateRetriever from "./fixtures/MockDateRetriever";

describe("Split projection, given a projection with a split definition", () => {

    let subject:SplitProjectionRunner<number>;
    let stream:TypeMoq.IMock<IStreamFactory>;
    let notifications:Event[];
    let stopped:boolean;
    let failed:boolean;
    let subscription:IDisposable;
    let readModelFactory:TypeMoq.IMock<IReadModelFactory>;
    let streamData:Subject<Event>;
    let readModelData:Subject<Event>;
    let projection = new SplitProjectionDefinition().define();

    beforeEach(() => {
        notifications = [];
        stopped = false;
        failed = false;
        streamData = new ReplaySubject<Event>();
        readModelData = new ReplaySubject<Event>();
        stream = TypeMoq.Mock.ofType<IStreamFactory>(MockStreamFactory);
        readModelFactory = TypeMoq.Mock.ofType<IReadModelFactory>(ReadModelFactory);
        subject = new SplitProjectionRunner<number>(projection, stream.object, new Matcher(projection.definition),
            new Matcher(projection.split), readModelFactory.object, new MockStreamFactory(Observable.empty<Event>()),
            new MockDateRetriever(new Date(100000)));
        subscription = subject.notifications().subscribe((event: Event) => notifications.push(event), e => failed = true, () => stopped = true);
    });

    context("when initializing the projection", () => {
        context("and a snapshot is present", () => {
            beforeEach(() => {
                stream.setup(s => s.from(TypeMoq.It.isAny(), TypeMoq.It.isAny(), TypeMoq.It.isValue(projection.definition))).returns(_ => streamData.observeOn(Scheduler.immediate));
                readModelFactory.setup(r => r.from(null)).returns(a => readModelData.observeOn(Scheduler.immediate));
                readModelData.onNext({
                    type: "LinkedState",
                    payload: {
                        count2: 2000
                    },
                    timestamp: new Date(1), splitKey: null
                });
                subject.run(new Snapshot(<Dictionary<number>>{
                    "10a": 2000,
                    "25b": 5600
                }, new Date(5000)));
            });
            it("should construct the snapshotted projections", () => {
                expect(subject.state["10a"]).to.be(4000);
                expect(subject.state["25b"]).to.be(7600);
            });
            it("should subscribe to the event stream starting from the snapshot timestamp", () => {
                stream.verify(s => s.from(TypeMoq.It.isValue(new Date(5000)), TypeMoq.It.isAny(), TypeMoq.It.isValue(projection.definition)), TypeMoq.Times.once());
            });
        });
    });

    context("when a new event is received", () => {
        beforeEach(() => {
            stream.setup(s => s.from(null, TypeMoq.It.isAny(), TypeMoq.It.isValue(projection.definition))).returns(_ => streamData.observeOn(Scheduler.immediate));
        });

        context("and the event is not defined", () => {
            beforeEach(() => readModelFactory.setup(r => r.from(null)).returns(_ => Observable.empty<Event>()));
            it("should continue replaying the stream", () => {
                subject.run();
                streamData.onNext({
                    type: "TestEvent",
                    payload: {
                        count: 20,
                        id: "10"
                    },
                    timestamp: new Date(10), splitKey: null
                });
                streamData.onNext({type: "invalid", payload: 10, timestamp: new Date(20), splitKey: null});
                streamData.onNext({
                    type: "TestEvent",
                    payload: {
                        count: 50,
                        id: "10"
                    },
                    timestamp: new Date(30), splitKey: null
                });
                expect(subject.state["10"]).to.be(80);
            });
        });

        context("and a state is present for the generated split key", () => {
            beforeEach(() => {
                readModelFactory.setup(r => r.from(null)).returns(_ => Observable.empty<Event>());
                subject.run(new Snapshot(<Dictionary<number>>{
                    "10": 30
                }, null));
                streamData.onNext({
                    type: "TestEvent",
                    payload: {
                        count: 50,
                        id: "10"
                    },
                    timestamp: new Date(30), splitKey: null
                });
            });

            it("should update the projection state", () => {
                expect(subject.state["10"]).to.be(80);
            });

            it("should notify that the read model has changed", () => {
                expect(notifications).to.have.length(1);
                expect(notifications[0].splitKey).to.be("10");
                expect(notifications[0].payload).to.be(80);
            });
        });

        context("and a state is not present for the generated split key", () => {
            beforeEach(() => {
                readModelFactory.setup(r => r.from(null)).returns(_ => Observable.empty<Event>());
                readModelFactory.setup(r => r.asList()).returns(a => [
                    {
                        type: "LinkedState",
                        payload: {
                            count2: 2000
                        },
                        timestamp: new Date(30), splitKey: null
                    }
                ]);
            });
            it("should initialize the new projection by pushing all the generated read models", () => {
                subject.run();
                streamData.onNext({
                    type: "TestEvent",
                    payload: {
                        count: 20,
                        id: "10"
                    },
                    timestamp: new Date(10), splitKey: null
                });
                expect(subject.state["10"]).to.be(2030);
            });
        });

        context("and the event is a read model", () => {
            beforeEach(() => {
                streamData.onNext({
                    type: "TestEvent",
                    payload: {
                        count: 20,
                        id: "10"
                    },
                    timestamp: new Date(10), splitKey: null
                });
                readModelFactory.setup(r => r.from(null)).returns(a => readModelData.observeOn(Scheduler.immediate));
                readModelData.onNext({
                    type: "LinkedState",
                    payload: {
                        count2: 5000
                    },
                    timestamp: new Date(30), splitKey: null
                });
                subject.run();
            });

            it("should dispatch the read model to all the projections", () => {
                expect(subject.state["10"]).to.be(5030);
            });

            it("should notify the changes of the states", () => {
                expect(notifications).to.have.length(2);
                expect(notifications[1].payload).to.be(5030);
                expect(notifications[1].splitKey).to.be("10");
            });

            context("of the same projection", () => {
                it("should filter it", () => {
                    streamData.onNext({type: "split", payload: 10, timestamp: new Date(50), splitKey: null});
                    expect(subject.state["10"]).to.be(5030);
                });
            });
        });
    });
});