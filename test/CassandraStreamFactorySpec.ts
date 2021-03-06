import "reflect-metadata";
import expect = require("expect.js");
import * as TypeMoq from "typemoq";
import CassandraStreamFactory from "../scripts/cassandra/CassandraStreamFactory";
import MockEventsFilter from "./fixtures/MockEventsFilter";
import TimePartitioner from "../scripts/cassandra/TimePartitioner";
import {ICassandraClient, IQuery} from "../scripts/cassandra/ICassandraClient";
import MockCassandraClient from "./fixtures/cassandra/MockCassandraClient";
import * as Rx from "rx";
import {Event} from "../scripts/streams/Event";
import IDateRetriever from "../scripts/util/IDateRetriever";
import MockDateRetriever from "./fixtures/MockDateRetriever";
import MockEventDeserializer from "./fixtures/MockEventDeserializer";
const anyValue = TypeMoq.It.isAny();

describe("Cassandra stream factory, given a stream factory", () => {

    let client: TypeMoq.IMock<ICassandraClient>;
    let subject: CassandraStreamFactory;
    let timePartitioner: TypeMoq.IMock<TimePartitioner>;
    let events: Event[];
    let dateRetriever: TypeMoq.IMock<IDateRetriever>;
    let endDate = new Date(600);

    beforeEach(() => {
        events = [];
        dateRetriever = TypeMoq.Mock.ofType(MockDateRetriever);
        let eventsFilter = TypeMoq.Mock.ofType(MockEventsFilter);
        timePartitioner = TypeMoq.Mock.ofType(TimePartitioner);
        let cassandraDeserializer = new MockEventDeserializer();
        client = TypeMoq.Mock.ofType(MockCassandraClient);
        client.setup(c => c.execute(TypeMoq.It.isValue<IQuery>(["select distinct ser_manifest from event_types", null]))).returns(a => Rx.Observable.just({
            rows: [
                {"ser_manifest": "Event1"},
                {"ser_manifest": "Event2"}
            ]
        }));
        client.setup(c => c.execute(TypeMoq.It.isValue<IQuery>(["select distinct timebucket from event_by_timestamp", null]))).returns(a => Rx.Observable.just({
            rows: [
                {"timebucket": "20150003"},
                {"timebucket": "20150001"},
                {"timebucket": "20150002"}
            ]
        }));
        dateRetriever.setup(d => d.getDate()).returns(() => new Date(1000));
        eventsFilter.setup(e => e.filter(TypeMoq.It.isAny())).returns(a => ["Event1"]);
        subject = new CassandraStreamFactory(client.object, timePartitioner.object, cassandraDeserializer,
            eventsFilter.object, dateRetriever.object, {
                hosts: [],
                keyspace: "",
                readDelay: 400
            });
    });

    context("when all the events needs to be fetched", () => {
        beforeEach(() => {
            setupClient(client, null, endDate);
        });

        it("should retrieve the events from the beginning", () => {
            subject.from(null, Rx.Observable.empty<string>(), {}).subscribe(event => events.push(event));
            expect(events).to.have.length(3);
            expect(events[0].payload).to.be(10);
            expect(events[1].payload).to.be(20);
            expect(events[2].payload).to.be(30);
        });
    });

    context("when starting the stream from any point", () => {
        beforeEach(() => {
            setupClient(client, null, endDate);
        });

        it("should read the events with a configured delay", () => {
            subject.from(null, Rx.Observable.empty<string>(), {}).subscribe(() => null);
            client.verify(c => c.paginate(TypeMoq.It.isValue<IQuery>(["select blobAsText(event) as event, timestamp from event_by_manifest " +
            "where timebucket = :bucket and ser_manifest = :event and timestamp < minTimeUuid(:endDate)", {
                bucket: "20150001",
                event: "Event1",
                endDate: endDate.toISOString()
            }]), anyValue), TypeMoq.Times.once());
        });
    });

    context("when starting the stream from a certain point", () => {
        beforeEach(() => {
            timePartitioner.setup(t => t.bucketsFrom(TypeMoq.It.isValue(new Date(1420160400000)))).returns(a => [
                "20150002", "20150003"
            ]);
            setupClient(client, new Date(1420160400000), endDate);
        });

        it("should retrieve the events in all the buckets greater than that point", () => {
            subject.from(new Date(1420160400000), Rx.Observable.empty<string>(), {}).subscribe(event => events.push(event));
            expect(events).to.have.length(1);
            expect(events[0].payload).to.be(30);
        });
    });

    function setupClient(client: TypeMoq.IMock<ICassandraClient>, startDate: Date, endDate: Date) {
        client.setup(c => c.paginate(TypeMoq.It.isValue<IQuery>(buildQuery("20150001", startDate, endDate)), anyValue))
            .returns(a => Rx.Observable.create(observer => {
                observer.onNext({
                    type: "Event1",
                    payload: 10,
                    splitKey: null,
                    timestamp: new Date(1000)
                });
                observer.onNext({
                    type: "Event1",
                    payload: 20,
                    splitKey: null,
                    timestamp: new Date(2000)
                });
                observer.onCompleted();
                return Rx.Disposable.empty;
            }));
        client.setup(c => c.paginate(TypeMoq.It.isValue<IQuery>(buildQuery("20150002", startDate, endDate)), anyValue))
            .returns(a => Rx.Observable.create(observer => {
                observer.onCompleted();
                return Rx.Disposable.empty;
            }));
        client.setup(c => c.paginate(TypeMoq.It.isValue<IQuery>(buildQuery("20150003", startDate, endDate)), anyValue))
            .returns(a => Rx.Observable.create(observer => {
                observer.onNext({
                    type: "Event1",
                    payload: 30,
                    splitKey: null,
                    timestamp: new Date(5000)
                });
                observer.onCompleted();
                return Rx.Disposable.empty;
            }));
    }

    function buildQuery(bucket: string, startDate: Date, endDate: Date): IQuery {
        let query = "select blobAsText(event) as event, timestamp from event_by_manifest " +
                "where timebucket = :bucket and ser_manifest = :event and timestamp < minTimeUuid(:endDate)",
            params: any = {
                bucket: bucket,
                event: "Event1",
                endDate: endDate.toISOString()
            };
        if (startDate) {
            query += " and timestamp > maxTimeUuid(:startDate)";
            params.startDate = startDate.toISOString();
        }

        return [query, params];
    }
});